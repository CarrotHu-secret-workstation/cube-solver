/**
 * Application entry: binds the Kociemba solver to the interactive 3D cube.
 *
 * Two representations are kept in lockstep:
 *   cube - the solver's cubie model (source of truth for legality/solving)
 *   view - the three.js scene, which advances its own cubie positions and
 *          orientations whenever a turn lands
 * After each turn the view's stickers are repainted from the model's facelet
 * string, so what the user sees is exactly what the solver reasons about.
 */

import { CubeView } from './cube3d.js';
import { PointerController } from './pointer.js';
import { FACE_NAMES } from './facemeta.js';
import {
  solvedCube, cloneCube, applyFace, applyAlg, toFacelets, isSolved,
  randomScramble, algToString, validate, FACES,
} from '../solver/cubie.js';
import { createSolver, ensureTables } from '../solver/search.js';

/**
 * Build stamp. Bump this whenever a fix lands: it is shown in the panel and
 * exposed on window.__cube.version, so "am I running the fixed code?" is a
 * one-glance question instead of a guess.
 *
 * r4  bakes each turn's rotation into the cubie (snapped to the 24
 *     axis-aligned orientations), removing the bare dark faces.
 * r5  replaces the spherical (theta, phi) camera with an unlimited
 *     quaternion orbit camera: the old phi clamp stopped vertical drags at
 *     a pole, so the view could not be rotated past a certain angle.
 */
const BUILD = 'r5-unlimited-orbit';

const $ = (id) => document.getElementById(id);

const el = {
  build: $('build'),
  host: $('canvas-host'),
  scrambleText: $('scramble-text'),
  solutionText: $('solution-text'),
  solLen: $('sol-len'),
  status: $('solve-status'),
  speed: $('speed'),
  speedVal: $('speed-val'),
  btnScramble: $('btn-scramble'),
  btnSolve: $('btn-solve'),
  btnReset: $('btn-reset'),
  btnUndo: $('btn-undo'),
  moveButtons: $('move-buttons'),
};

/* ---------------- state ---------------- */

let cube = solvedCube();
let history = [];        // moves applied since the last reset (for Undo)
let solutionAlg = [];    // last computed solution
let solverReady = false;
let solve = null;

/* ---------------- view ---------------- */

const view = new CubeView(el.host);
view.resetToSolved(toFacelets(cube));
if (el.build) el.build.textContent = BUILD;   // visible proof of which code is live

/** Repaint the model's current facelets onto the view's stickers. */
function repaint() {
  view.setFacelets(toFacelets(cube));
}

/** Hard reset of both representations to the solved state. */
function hardReset() {
  view.cancelAll();
  cube = solvedCube();
  history = [];
  view.resetToSolved(toFacelets(cube));
}

function animate() {
  requestAnimationFrame(animate);
  view.step(performance.now());
}

/** Slider value (1..10) -> per-move duration in ms (fast..slow). */
function speedMs() {
  const v = Number(el.speed.value);
  return Math.round(300 - v * 24);   // 276ms .. 60ms
}

function setStatus(msg, kind) {
  el.status.textContent = msg || '';
  el.status.className = 'status' + (kind ? ' ' + kind : '');
}

function renderAlg(container, moves, numbered) {
  container.textContent = '';
  if (!moves.length) { container.textContent = '—'; return; }
  moves.forEach((m, i) => {
    const span = document.createElement('span');
    span.className = 'mv';
    span.textContent = (numbered ? (i + 1) + '.' : '') + FACES[m.face]
      + (m.amount === 1 ? '' : m.amount === 2 ? '2' : "'");
    container.appendChild(span);
    if (i < moves.length - 1) container.appendChild(document.createTextNode(' '));
  });
}

/* ---------------- turn pipeline ---------------- */

/**
 * Queue one turn.
 *
 * The model advances when THAT move lands, not when the whole batch does, so a
 * 20-move scramble or a 20-move solution keeps the solver model and the view in
 * lockstep from the first move to the last. Each queued move carries its own
 * callback, so callbacks never overwrite one another.
 */
function turn(mv, opts = {}) {
  view.enqueue(mv, {
    ms: opts.ms ?? speedMs(),
    onDone: (done) => {
      applyFace(cube, done.face, done.amount);
      if (opts.record !== false) history.push({ face: done.face, amount: done.amount });
      repaint();
      if (opts.onDone) opts.onDone();
    },
  });
}

/* ---------------- actions ---------------- */

function doScramble() {
  if (view.busy) return;
  solutionAlg = [];
  renderAlg(el.solutionText, []);
  el.solLen.textContent = '';
  setStatus('');

  const moves = randomScramble(20);
  renderAlg(el.scrambleText, moves, false);
  hardReset();

  moves.forEach((m, i) => {
    turn(m, {
      record: true,
      ms: Math.max(45, speedMs() - 50),
      onDone: i === moves.length - 1
        ? () => setStatus('已打乱，点击「求解并复原」', 'ok') : undefined,
    });
  });
}

function doReset() {
  hardReset();
  solutionAlg = [];
  renderAlg(el.scrambleText, []);
  renderAlg(el.solutionText, []);
  el.solLen.textContent = '';
  setStatus('已复位', '');
}

function doUndo() {
  if (view.busy) return;
  if (!history.length) { setStatus('没有可撤销的步骤', ''); return; }
  const last = history.pop();
  turn({ face: last.face, amount: (4 - last.amount) % 4 }, { record: false, ms: speedMs() });
  setStatus('');
}

function playSolution() {
  const total = solutionAlg.length;
  solutionAlg.forEach((m, i) => {
    turn(m, {
      record: true,
      onDone: () => {
        if (i === total - 1) {
          setStatus(isSolved(cube) ? '复原完成 ✔' : '复原结束', isSolved(cube) ? 'ok' : '');
        } else if (i % 3 === 0 || i === total - 2) {
          setStatus('复原中… ' + (i + 1) + '/' + total, '');
        }
      },
    });
  });
}

function doSolve() {
  if (view.busy) return;
  if (!solverReady) { setStatus('求解器仍在初始化…', ''); return; }
  if (isSolved(cube)) { setStatus('魔方已经是复原状态', 'ok'); return; }

  const bad = validate(cube);
  if (bad) { setStatus('状态不可解：' + bad, 'err'); return; }

  setStatus('正在求解…', '');
  el.btnSolve.disabled = true;

  /* let the UI paint before the synchronous search runs */
  setTimeout(() => {
    const t0 = performance.now();
    let result = null, err = null;
    try { result = solve(cube); } catch (e) { err = e; }
    const ms = Math.round(performance.now() - t0);
    el.btnSolve.disabled = false;

    if (err) { setStatus('求解出错：' + err.message, 'err'); return; }
    if (!result || !result.moves.length) {
      setStatus('未能找到解，请重新打乱再试', 'err');
      return;
    }

    solutionAlg = result.moves;
    renderAlg(el.solutionText, solutionAlg, true);
    el.solLen.textContent = '共 ' + solutionAlg.length + ' 步 · ' + ms + 'ms';
    setStatus('开始复原…', '');
    playSolution();
  }, 20);
}

/* ---------------- manual move buttons ---------------- */

function buildMoveButtons() {
  el.moveButtons.textContent = '';
  for (let f = 0; f < 6; f++) {
    for (const amount of [1, 3]) {
      const b = document.createElement('button');
      b.textContent = FACE_NAMES[f] + (amount === 1 ? '' : "'");
      b.onclick = () => {
        if (view.busy) return;
        turn({ face: f, amount }, { record: true, ms: speedMs() });
      };
      el.moveButtons.appendChild(b);
    }
  }
}

/* ---------------- pointer interaction ---------------- */

new PointerController(view, el.host, {
  onTurn: (mv) => {
    if (view.busy) return;
    setStatus('');
    turn(mv, { record: true, ms: speedMs() });
  },
});

/* ---------------- wiring ---------------- */

el.btnScramble.onclick = doScramble;
el.btnReset.onclick = doReset;
el.btnUndo.onclick = doUndo;
el.btnSolve.onclick = doSolve;
el.speed.oninput = () => {
  const v = Number(el.speed.value);
  el.speedVal.textContent = v <= 3 ? '慢' : v <= 7 ? '正常' : '快';
};

buildMoveButtons();
animate();

/* ---------------- solver bootstrap ---------------- */

el.btnSolve.disabled = true;
setStatus('正在构建求解表…', '');

setTimeout(() => {
  try {
    ensureTables();
    solve = createSolver({ maxTimeMs: 3000, maxSolutions: 60, maxPhase1: 12, maxDepth: 24 });
    solverReady = true;
    el.btnSolve.disabled = false;
    setStatus('求解器就绪（Kociemba 二阶段）', 'ok');
  } catch (e) {
    setStatus('求解器初始化失败：' + e.message, 'err');
  }
}, 30);

/* expose a tiny hook so automated tests can wait for readiness and inspect
 * the view; `audit()` compares rendered stickers against the solver model, so a
 * missing (dark) sticker or a wrong colour is detectable from a test. */
window.__cube = {
  version: BUILD,
  isReady: () => solverReady,
  isBusy: () => view.busy,
  facelets: () => toFacelets(cube),
  isSolved: () => isSolved(cube),
  audit: () => view.audit(toFacelets(cube)),
  manualTurn: (face, amount) => turn({ face, amount }, { record: true, ms: 20 }),
  view,
};
