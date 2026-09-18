/**
 * Browser verification suite.
 *
 * Starts the dev server, then drives two pages in headless Chrome:
 *   1. test/e2e.html   - renderer + solver + interaction unit checks in a real
 *                        WebGL context
 *   2. index.html      - the real application: scramble -> solve -> solved
 * Prints a PASS/FAIL summary and writes screenshots to /tmp.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = 8788;
const CDP = 9700 + Math.floor(Math.random() * 200);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- start the dev server on a private port ---- */
const server = spawn(process.execPath, [join(root, 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: 'ignore',
});
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await sleep(200);
  try { up = (await fetch('http://127.0.0.1:' + PORT + '/')).ok; } catch {}
}
if (!up) { console.log('FAIL  dev server did not start'); server.kill('SIGKILL'); process.exit(1); }

/* ---- launch chrome ---- */
const profile = mkdtempSync(join(tmpdir(), 'cubesuite-'));
const chrome = spawn('google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=1400,900', '--hide-scrollbars',
  '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile, 'about:blank',
], { stdio: 'ignore' });

let ws, id = 0; const pend = new Map(); const logs = [];
const send = (method, params = {}, sid) => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) }));
  return new Promise((res, rej) => pend.set(i, { res, rej }));
};

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail: detail || '' }); }

try {
  let ver = null;
  for (let i = 0; i < 100 && !ver; i++) {
    try { ver = await (await fetch('http://127.0.0.1:' + CDP + '/json/version')).json(); }
    catch { await sleep(200); }
  }
  if (!ver) throw new Error('chrome debug port unavailable');
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id); pend.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push('ERR ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  };

  async function openPage(url) {
    const t = await send('Target.createTarget', { url: 'about:blank' });
    const s = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    const sid = s.sessionId;
    await send('Runtime.enable', {}, sid);
    await send('Page.enable', {}, sid);
    await send('Page.navigate', { url }, sid);
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result && r.result.value;
    };
    const shot = async (p) => {
      const r = await send('Page.captureScreenshot', { format: 'png' }, sid);
      writeFileSync(p, Buffer.from(r.data, 'base64'));
    };
    return { sid, ev, shot };
  }

  /* ================= 1. renderer + solver harness ================= */
  {
    const { ev, shot } = await openPage('http://127.0.0.1:' + PORT + '/test/e2e.html');
    let done = null;
    for (let i = 0; i < 300; i++) {
      await sleep(500);
      try {
        const v = await ev('JSON.stringify(window.__E2E_DONE__ || null)');
        if (v && v !== 'null') { done = JSON.parse(v); break; }
      } catch {}
    }
    record('e2e harness completes', !!done, done ? '' : 'timed out');
    if (done) {
      record('e2e all checks pass', done.fail === 0, 'pass=' + done.pass + ' fail=' + done.fail);
      for (const line of String(done.text).split('\n')) {
        if (line.startsWith('FAIL')) record('  ' + line.slice(5), false, '');
      }
    }
    await shot('/tmp/cube-e2e.png');
  }

  /* ================= 2. the real application ================= */
  {
    const { ev, shot } = await openPage('http://127.0.0.1:' + PORT + '/');

    /* run animations as fast as possible so the test is quick */
    await ev('(() => { const s = document.getElementById("speed"); s.value = 10; s.dispatchEvent(new Event("input")); return s.value; })()');

    let ready = false;
    for (let i = 0; i < 200; i++) {
      await sleep(400);
      try { if (await ev('!!(window.__cube && window.__cube.isReady())')) { ready = true; break; } } catch {}
    }
    record('app: solver becomes ready', ready, '');
    record('app: 3D canvas present', await ev('!!document.querySelector("#canvas-host canvas")'), '');
    record('app: 12 manual turn buttons', (await ev('document.querySelectorAll("#move-buttons button").length')) === 12, '');

    /* ---- view/model consistency: no dark holes, no wrong colours ---- */
    const audit = async () => JSON.parse(await ev('JSON.stringify(window.__cube.audit())'));
    const a0 = await audit();
    record('app: stickers match the model on load', a0.holes === 0 && a0.mismatched === 0, JSON.stringify(a0));

    /* manual turns must keep every visible sticker intact */
    for (const [f, amt] of [[0, 1], [1, 1], [2, 1], [0, 3], [4, 1], [5, 1], [1, 2], [2, 3]]) {
      await ev(`window.__cube.manualTurn(${f}, ${amt})`);
      await sleep(120);
    }
    let settled = false;
    for (let i = 0; i < 60 && !settled; i++) { await sleep(100); settled = !(await ev('window.__cube.isBusy()')); }
    const a1 = await audit();
    record('app: manual turns keep all stickers intact', a1.holes === 0 && a1.mismatched === 0, JSON.stringify(a1));
    await shot('/tmp/cube-app-manual.png');

    /* reset after manual turns must fully restore the view */
    await ev('document.getElementById("btn-reset").click()');
    await sleep(300);
    const a2 = await audit();
    record('app: reset restores a clean view', a2.holes === 0 && a2.mismatched === 0, JSON.stringify(a2));
    record('app: reset leaves the model solved', (await ev('window.__cube.isSolved()')) === true, '');

    /* scramble */
    await ev('document.getElementById("btn-scramble").click()');
    let scramDone = false, scramText = '';
    for (let i = 0; i < 300; i++) {
      await sleep(250);
      const busy = await ev('window.__cube.isBusy()');
      const solved = await ev('window.__cube.isSolved()');
      scramText = await ev('document.getElementById("scramble-text").textContent');
      if (!busy && !solved) { scramDone = true; break; }
    }
    record('app: scramble animates to a scrambled state', scramDone, scramText.slice(0, 60));
    record('app: scrambled state is a valid cube', await ev('window.__cube.facelets().length === 54'), '');
    const a3 = await audit();
    record('app: scramble leaves every sticker intact', a3.holes === 0 && a3.mismatched === 0, JSON.stringify(a3));
    await shot('/tmp/cube-app-scrambled.png');

    /* a SECOND scramble is the case that used to corrupt the view */
    await ev('document.getElementById("btn-scramble").click()');
    for (let i = 0; i < 300; i++) {
      await sleep(250);
      const busy = await ev('window.__cube.isBusy()');
      const solved = await ev('window.__cube.isSolved()');
      if (!busy && !solved) break;
    }
    const a3b = await audit();
    record('app: second scramble leaves every sticker intact', a3b.holes === 0 && a3b.mismatched === 0, JSON.stringify(a3b));

    /* scramble right after manual turns (the reported repro) */
    await ev('window.__cube.manualTurn(0, 1)');
    await sleep(200);
    await ev('document.getElementById("btn-reset").click()');
    await sleep(200);
    await ev('window.__cube.manualTurn(2, 1)');
    await sleep(200);
    await ev('document.getElementById("btn-scramble").click()');
    for (let i = 0; i < 300; i++) {
      await sleep(250);
      const busy = await ev('window.__cube.isBusy()');
      const solved = await ev('window.__cube.isSolved()');
      if (!busy && !solved) break;
    }
    const a3c = await audit();
    record('app: scramble after manual turns leaves every sticker intact', a3c.holes === 0 && a3c.mismatched === 0, JSON.stringify(a3c));

    /* solve */
    await ev('document.getElementById("btn-solve").click()');
    let solShown = false, solText = '', solLen = '';
    for (let i = 0; i < 100; i++) {
      await sleep(200);
      solText = await ev('document.getElementById("solution-text").textContent');
      solLen = await ev('document.getElementById("sol-len").textContent');
      if (solText && solText.indexOf('—') < 0 && solText.length > 2) { solShown = true; break; }
    }
    record('app: solution is displayed', solShown, solLen);

    let finalStatus = '';
    for (let i = 0; i < 800; i++) {
      await sleep(250);
      finalStatus = await ev('document.getElementById("solve-status").textContent');
      const busy = await ev('window.__cube.isBusy()');
      if (!busy && (finalStatus.indexOf('复原完成') >= 0 || finalStatus.indexOf('复原结束') >= 0)) break;
    }
    const solved = await ev('window.__cube.isSolved()');
    record('app: cube is solved after replay', solved === true, 'status="' + finalStatus + '"');
    const a4 = await audit();
    record('app: restored cube shows a clean solved view', a4.holes === 0 && a4.mismatched === 0, JSON.stringify(a4));
    const shown = await ev('(() => { const f = window.__cube.facelets(); return f === "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"; })()');
    record('app: model facelets are the solved string', shown === true, '');
    await shot('/tmp/cube-app-solved.png');

    /* undo works */
    await ev('document.getElementById("btn-undo").click()');
    await sleep(700);
    const afterUndo = await ev('window.__cube.isSolved()');
    record('app: undo leaves the cube (no longer solved)', afterUndo === false, '');

    /* reset works */
    await ev('document.getElementById("btn-reset").click()');
    await sleep(400);
    record('app: reset returns to solved', (await ev('window.__cube.isSolved()')) === true, '');

    record('app: no console errors', logs.length === 0, logs.slice(0, 3).join(' | '));
  }

  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log('');
  for (const r of results) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '   [' + r.detail + ']' : ''));
  }
  console.log('\nBROWSER SUITE  pass=' + pass + ' fail=' + fail);
  writeFileSync('/tmp/cube-browser-suite.json', JSON.stringify({ pass, fail, results, logs }, null, 2));
  process.exitCode = fail === 0 ? 0 : 1;
} catch (e) {
  console.log('BROWSER SUITE ERROR: ' + (e && e.stack || e));
  process.exitCode = 2;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill('SIGKILL');
  server.kill('SIGKILL');
}
