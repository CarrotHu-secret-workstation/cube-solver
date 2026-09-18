/**
 * Headless regression test for the view's cubie bookkeeping.
 *
 * CubeView tracks, per cubie:
 *   pos  - current grid slot
 *   ori  - ori[worldFace] = which glued sticker of THIS cubie faces that way
 *   mats - sticker materials that exist on the cubie (built once, at the
 *          cubie's canonical home slot)
 *
 * The view is healthy iff, for every cubie and every world direction it
 * currently shows, `mats[ori[w]]` exists. When it does not, that direction has
 * no sticker mesh and renders as a bare dark body face — the "colour block
 * disappeared" symptom.
 *
 * This file reproduces that bookkeeping exactly (no DOM, no WebGL) so the bug
 * is caught by a fast unit test instead of only in a browser.
 */
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { rotVec, advanceSlot, facePermutation, turnQuarter, visibleFaces } from '../src/ui/cube3d.js';
import { FACE_AXIS, FACE_LAYER, FACE_NAMES } from '../src/ui/facemeta.js';
import { randomScramble, applyAlg, FACES, solvedCube } from '../src/solver/cubie.js';

/** Build the 27 cubies exactly like CubeView.build(). */
function buildCubies() {
  const cubies = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const mats = new Set(visibleFaces(x, y, z));
    cubies.push({ home: [x, y, z], pos: [x, y, z], ori: [0, 1, 2, 3, 4, 5], mats });
  }
  return cubies;
}

/** Apply one landed turn exactly like CubeView.finishMove(). */
function applyMove(cubies, face, amount) {
  const k = FACE_AXIS[face];
  const q = turnQuarter(face, amount);
  const P = facePermutation(k, q);
  const layer = FACE_LAYER[face];

  for (const g of cubies) {
    if (g.pos[k] !== layer) continue;

    g.pos = advanceSlot(g.pos, k, q);   // the real helper, not a re-implementation

    const nOri = new Array(6);
    for (let w = 0; w < 6; w++) nOri[P[w]] = g.ori[w];
    g.ori = nOri;
  }
}

/** Count visible directions with no sticker mesh, and report a sample. */
function audit(cubies) {
  let holes = 0, checks = 0;
  const samples = [];
  for (const g of cubies) {
    for (const w of visibleFaces(g.pos[0], g.pos[1], g.pos[2])) {
      checks++;
      if (!g.mats.has(g.ori[w])) {
        holes++;
        if (samples.length < 6) {
          samples.push({
            home: g.home, pos: g.pos, worldFace: FACE_NAMES[w],
            ori: g.ori.slice(), stickerFaces: g.ori.map((f) => FACE_NAMES[f]).join(','),
            available: [...g.mats].map((f) => FACE_NAMES[f]).join(','),
          });
        }
      }
    }
  }
  return { holes, checks, samples };
}

/* ------------------------------------------------------------------ *
 * Root-cause guard.
 *
 * turnQuarter() returns -1 for U/R/F clockwise and for D/L/B
 * counter-clockwise. Any position update written as
 *     for (let i = 0; i < quarter; i++) ...
 * therefore does NOTHING for half of all turns, leaving `pos` stale while
 * `ori` still advances. That is exactly what produced bare dark faces.
 * Assert the real helper turns negative quarters into the correct slot.
 * ------------------------------------------------------------------ */
let guardBad = [];

/* advanceSlot must agree with rotVec — the canonical right-handed rotation that
 * facePermutation is built on. Comparing against rotVec (computed) rather than
 * hand-written numbers means this test cannot encode a mis-derived value. */
const PROBE = [
  [0, 1, 1], [1, 1, 0], [1, 1, 1], [1, 0, -1], [-1, 1, 0],
  [1, -1, 1], [-1, -1, -1], [0, 1, 0], [1, 0, 0], [0, 0, 1],
];
for (const pos of PROBE) {
  for (let k = 0; k < 3; k++) {
    for (const q of [1, -1, 2, -2, 3, -3]) {
      const a = advanceSlot(pos, k, q);
      const r = rotVec(new THREE.Vector3(pos[0], pos[1], pos[2]), k, q);
      if (a[0] !== r.x || a[1] !== r.y || a[2] !== r.z) {
        guardBad.push(`advanceSlot ${JSON.stringify(pos)} k=${k} q=${q} got=${JSON.stringify(a)} rotVec=(${r.x},${r.y},${r.z})`);
      }
    }
  }
}

/* THE REGRESSION: a negative quarter must actually MOVE an off-axis cubie.
 * `for (i = 0; i < q; i++)` silently did nothing for q = -1, which is half of
 * all face turns, leaving `pos` stale while `ori` advanced. */
for (const pos of [[0, 1, 1], [1, 1, 0], [1, 1, 1], [-1, 1, 0], [0, -1, 1]]) {
  for (let k = 0; k < 3; k++) {
    if (pos[k] === 0) continue;          // on-axis cubies legitimately stay put
    for (const q of [-1, -3]) {
      const a = advanceSlot(pos, k, q);
      if (a[0] === pos[0] && a[1] === pos[1] && a[2] === pos[2]) {
        guardBad.push(`negative quarter was a NO-OP: pos=${JSON.stringify(pos)} k=${k} q=${q}`);
      }
    }
  }
}

/* four quarter turns in either direction must return to the start */
for (const pos of PROBE) {
  for (let k = 0; k < 3; k++) {
    for (const dir of [1, -1]) {
      let p = pos;
      for (let i = 0; i < 4; i++) p = advanceSlot(p, k, dir);
      if (p[0] !== pos[0] || p[1] !== pos[1] || p[2] !== pos[2]) {
        guardBad.push(`4x q=${dir} failed k=${k} pos=${JSON.stringify(pos)}`);
      }
    }
  }
}

/* negative and positive quarters must be inverses of one another */
for (let k = 0; k < 3; k++) {
  for (const pos of [[1, 1, 1], [1, 0, -1], [-1, 1, 0], [1, -1, 1]]) {
    const fwd = advanceSlot(pos, k, 1);
    const back = advanceSlot(fwd, k, -1);
    if (back[0] !== pos[0] || back[1] !== pos[1] || back[2] !== pos[2]) {
      guardBad.push(`inverse failed k=${k} pos=${JSON.stringify(pos)}`);
    }
    /* four quarter turns must be the identity */
    let p = pos;
    for (let i = 0; i < 4; i++) p = advanceSlot(p, k, 1);
    if (p[0] !== pos[0] || p[1] !== pos[1] || p[2] !== pos[2]) {
      guardBad.push(`4x quarter failed k=${k} pos=${JSON.stringify(pos)}`);
    }
  }
}

const results = [];
const seqs = [
  ['U', [['U', 1]]],
  ['R', [['R', 1]]],
  ['F', [['F', 1]]],
  ['U2', [['U', 2]]],
  ['U\'', [['U', 3]]],
  ['U R', [['U', 1], ['R', 1]]],
  ['U R\'', [['U', 1], ['R', 3]]],
  ['U D', [['U', 1], ['D', 1]]],
  ['R U R\' U\'', [['R', 1], ['U', 1], ['R', 3], ['U', 3]]],
  ['U F R', [['U', 1], ['F', 1], ['R', 1]]],
  ['all six faces once', [['U', 1], ['R', 1], ['F', 1], ['D', 1], ['L', 1], ['B', 1]]],
];

for (const [label, moves] of seqs) {
  const cubies = buildCubies();
  for (const [faceName, amount] of moves) applyMove(cubies, FACES.indexOf(faceName), amount);
  const a = audit(cubies);
  results.push({ label, holes: a.holes, checks: a.checks, samples: a.samples });
}

/* long random sequences, the way the app is actually used */
for (let trial = 0; trial < 40; trial++) {
  const cubies = buildCubies();
  const scr = randomScramble(20);
  for (const m of scr) applyMove(cubies, m.face, m.amount);
  const a = audit(cubies);
  if (a.holes > 0 && results.every((r) => r.holes === 0)) {
    results.push({ label: 'random#' + trial, holes: a.holes, checks: a.checks, samples: a.samples });
  } else {
    results.push({ label: 'random#' + trial, holes: a.holes, checks: a.checks, samples: [] });
  }
}

const failing = results.filter((r) => r.holes > 0);
const summary = {
  negativeQuarterGuard: guardBad.length === 0,
  guardFailures: guardBad,
  sequences: results.length,
  failing: failing.length,
  totalHoles: results.reduce((s, r) => s + r.holes, 0),
  firstFailure: failing.length ? failing[0] : null,
};
writeFileSync(new URL('./viewsync-report.json', import.meta.url), JSON.stringify({ summary, results }, null, 2));

console.log('VIEWSYNC guard=' + (summary.negativeQuarterGuard ? 'OK' : 'FAILED') +
  ' sequences=' + summary.sequences + ' failing=' + summary.failing +
  ' totalHoles=' + summary.totalHoles);
if (guardBad.length) for (const b of guardBad.slice(0, 5)) console.log('  guard: ' + b);
process.exit(summary.failing === 0 && summary.negativeQuarterGuard ? 0 : 1);
