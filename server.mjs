/**
 * Minimal static dev server for the cube solver UI.
 *
 * Serves the project root and exposes the installed three.js build at
 * /vendor/three.module.js (the import map in index.html points there).
 * Solver tables are built in the browser on first use.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

/** Resolve a URL path to a file inside ROOT, or null when it escapes. */
function safeJoin(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const p = normalize(join(ROOT, clean));
  if (!p.startsWith(ROOT)) return null;
  return p;
}

async function readThree() {
  const candidates = [
    join(ROOT, 'node_modules/three/build/three.module.js'),
  ];
  for (const c of candidates) {
    try {
      await stat(c);
      return await readFile(c);
    } catch { /* try next */ }
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    let url = req.url || '/';

    /* three.js vendor alias */
    if (url === '/vendor/three.module.js' || url.startsWith('/vendor/three.module.js?')) {
      const buf = await readThree();
      if (!buf) { res.writeHead(500); res.end('three.js not found; run npm install'); return; }
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store, must-revalidate' });
      res.end(buf);
      return;
    }

    if (url === '/') url = '/index.html';
    const file = safeJoin(url);
    if (!file) { res.writeHead(403); res.end('forbidden'); return; }

    let target = file;
    try {
      const st = await stat(target);
      if (st.isDirectory()) target = join(target, 'index.html');
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 ' + url);
      return;
    }

    const buf = await readFile(target);
    /* `no-store` (not `no-cache`): during development a stale ES module in the
     * browser cache looks exactly like a broken app, and no-cache still lets
     * the browser reuse a cached copy after revalidation. `no-store` guarantees
     * every refresh serves the file that is actually on disk. */
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(buf);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 ' + err.message);
  }
});

server.listen(PORT, HOST, () => {
  console.log('cube-solver dev server: http://' + HOST + ':' + PORT + '/');
});
