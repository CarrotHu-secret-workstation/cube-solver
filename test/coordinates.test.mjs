import {
  buildMoveTables, MOVES1, MOVES2, MOVES2_IDX,
  getTwist, getFlip, getSlice1, getCP, getEP8, getSP,
  setTwist, setFlip, setSlice1, setCP, setEP8, setSP,
  N_TWIST, N_FLIP, N_SLICE1, N_CP, N_EP8, N_SP,
  permRank, permUnrank, comboRank, comboUnrank, FACT, CNK,
} from '../src/solver/coordinates.js';
import { solvedCube, cloneCube, applyFace, applyAlg, randomScramble } from '../src/solver/cubie.js';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

/* ---- combinatorics round trip ---- */
let good = true;
for (let r = 0; r < FACT[8]; r++) {
  const p = permUnrank(r, 8);
  if (permRank(p) !== r) { good = false; console.log('perm mismatch', r); break; }
}
ok('permRank/permUnrank 8! round trip', good);

good = true;
for (let r = 0; r < CNK[12][4]; r++) {
  const c = comboUnrank(r, 4, 12);
  if (comboRank(c) !== r) { good = false; console.log('combo mismatch', r, c); break; }
  for (let i = 1; i < 4; i++) if (c[i] <= c[i - 1]) { good = false; console.log('not sorted', r, c); break; }
}
ok('comboRank/comboUnrank C(12,4) round trip', good);

/* ---- coordinate encoding round trip ---- */
const co = new Int8Array(8), eo = new Int8Array(12);
good = true;
for (let t = 0; t < N_TWIST; t++) {
  setTwist(t, co);
  if (getTwist(co) !== t) { good = false; console.log('twist', t); break; }
  let s = 0; for (let i = 0; i < 8; i++) s += co[i];
  if (s % 3 !== 0) { good = false; console.log('twist not valid', t); break; }
}
ok('twist encode/decode', good);

good = true;
for (let f = 0; f < N_FLIP; f++) {
  setFlip(f, eo);
  if (getFlip(eo) !== f) { good = false; console.log('flip', f); break; }
  let s = 0; for (let i = 0; i < 12; i++) s += eo[i];
  if (s % 2 !== 0) { good = false; console.log('flip not valid', f); break; }
}
ok('flip encode/decode', good);

good = true;
const ep = new Int8Array(12);
for (let s = 0; s < N_SLICE1; s++) {
  setSlice1(s, ep);
  if (getSlice1(ep) !== s) { good = false; console.log('slice1', s); break; }
}
ok('slice1 encode/decode', good);

good = true;
for (let r = 0; r < N_CP; r += 7) {
  const cp = new Int8Array(8);
  setCP(r, cp);
  if (getCP(cp) !== r) { good = false; console.log('cp', r); break; }
}
ok('cp encode/decode', good);

good = true;
for (let r = 0; r < N_EP8; r++) {
  const e2 = new Int8Array(12);
  setEP8(r, e2);
  for (let i = 8; i < 12; i++) e2[i] = i;
  if (getEP8(e2) !== r) { good = false; console.log('ep8', r); break; }
}
ok('ep8 encode/decode', good);

good = true;
for (let r = 0; r < N_SP; r++) {
  const e2 = new Int8Array(12);
  for (let i = 0; i < 8; i++) e2[i] = i;
  setSP(r, e2);
  if (getSP(e2) !== r) { good = false; console.log('sp', r, e2); break; }
}
ok('sp encode/decode', good);

/* ---- move tables agree with direct cubie moves ---- */
console.log('building move tables ...');
const t0 = Date.now();
const mt = buildMoveTables();
console.log('  built in ' + (Date.now() - t0) + ' ms');

const idx1 = (face, amount) => face * 3 + (amount - 1);

let mGood = true, mBad = '';
for (let trial = 0; trial < 400; trial++) {
  const cube = solvedCube();
  applyAlg(cube, randomScramble(12));

  const tw = getTwist(cube.co), fl = getFlip(cube.eo), sl = getSlice1(cube.ep);
  const cpv = getCP(cube.cp);

  for (let m = 0; m < 18; m++) {
    const { face, amount } = MOVES1[m];
    const nxt = cloneCube(cube);
    applyFace(nxt, face, amount);

    if (mt.twistMove[tw * 18 + m] !== getTwist(nxt.co)) { mGood = false; mBad = 'twist m' + m; }
    if (mt.flipMove[fl * 18 + m] !== getFlip(nxt.eo)) { mGood = false; mBad = 'flip m' + m; }
    if (mt.sliceMove[sl * 18 + m] !== getSlice1(nxt.ep)) { mGood = false; mBad = 'slice m' + m; }
    if (mt.cpMove[cpv * 18 + m] !== getCP(nxt.cp)) { mGood = false; mBad = 'cp m' + m; }
  }
  if (!mGood) { console.log('  mismatch', mBad); break; }
}
ok('phase-1 move tables match cubie moves (400 states x 18 moves)', mGood);

/* phase-2 tables: only valid for states already in G1 */
let g1Good = true, g1Bad = '';
for (let trial = 0; trial < 400; trial++) {
  const cube = solvedCube();
  // random phase-2 scramble keeps us in G1
  for (let i = 0; i < 12; i++) {
    const m = MOVES2[Math.floor(Math.random() * MOVES2.length)];
    applyFace(cube, m.face, m.amount);
  }
  const ep8v = getEP8(cube.ep), spv = getSP(cube.ep), cpv = getCP(cube.cp);
  for (let m = 0; m < 10; m++) {
    const { face, amount } = MOVES2[m];
    const nxt = cloneCube(cube);
    applyFace(nxt, face, amount);
    if (mt.ep8Move[ep8v * 10 + m] !== getEP8(nxt.ep)) { g1Good = false; g1Bad = 'ep8 m' + m; }
    if (mt.spMove[spv * 10 + m] !== getSP(nxt.ep)) { g1Good = false; g1Bad = 'sp m' + m; }
    if (mt.cpMove[cpv * 18 + MOVES2_IDX[m]] !== getCP(nxt.cp)) { g1Good = false; g1Bad = 'cp2 m' + m; }
  }
  if (!g1Good) { console.log('  mismatch', g1Bad); break; }
}
ok('phase-2 move tables match cubie moves (400 G1 states x 10 moves)', g1Good);

/* ---- coordinate goal is the solved state ---- */
const sc = solvedCube();
ok('solved twist/flip/slice1 are 0', getTwist(sc.co) === 0 && getFlip(sc.eo) === 0 && getSlice1(sc.ep) === 0);
ok('solved cp/ep8/sp are 0', getCP(sc.cp) === 0 && getEP8(sc.ep) === 0 && getSP(sc.ep) === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
