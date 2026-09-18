/**
 * Kociemba coordinates and coordinate-space move tables.
 *
 * Coordinates
 *   twist  0..2186   corner orientation        (3^7)
 *   flip   0..2047   edge orientation          (2^11)
 *   slice1 0..494    which 4 slots hold the FR/FL/BL/BR slice edges (C(12,4))
 *   cp     0..40319  corner permutation       (8!)
 *   ep8    0..40319  permutation of U/D edges in slots 0..7 (valid in G1)
 *   sp     0..23     permutation of slice edges in slots 8..11 (4!)
 *
 * Phase 1 coordinates: twist, flip, slice1   -> goal (0, 0, 0)
 * Phase 2 coordinates: cp, ep8, sp           -> goal (0, 0, 0)
 *
 * Every coordinate is 0 for the solved cube.
 */

import { MOVE_CP, MOVE_CO, MOVE_EP, MOVE_EO } from './cubie.js';

/* ====================================================================== *
 * Combinatorics
 * ====================================================================== */

export const FACT = [1];
for (let i = 1; i <= 12; i++) FACT[i] = FACT[i - 1] * i;

export const CNK = [];
for (let n = 0; n <= 12; n++) {
  CNK[n] = new Array(13).fill(0);
  CNK[n][0] = 1;
  for (let k = 1; k <= n; k++) {
    CNK[n][k] = (n === k ? 1 : CNK[n - 1][k - 1] + CNK[n - 1][k]);
  }
}

/** Lexicographic rank of a permutation, 0..n!-1. */
export function permRank(p) {
  const n = p.length;
  let rank = 0;
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let j = i + 1; j < n; j++) if (p[j] < p[i]) c++;
    rank += c * FACT[n - 1 - i];
  }
  return rank;
}

/** Inverse of permRank; writes into out when supplied. */
export function permUnrank(rank, n, out) {
  const p = out || new Array(n);
  const avail = [];
  for (let i = 0; i < n; i++) avail.push(i);
  let r = rank;
  for (let i = 0; i < n; i++) {
    const f = FACT[n - 1 - i];
    const idx = Math.floor(r / f);
    r -= idx * f;
    p[i] = avail.splice(idx, 1)[0];
  }
  return p;
}

/** Colex rank of a strictly ascending k-subset of 0..n-1, 0..C(n,k)-1. */
export function comboRank(arr) {
  let r = 0;
  for (let i = 0; i < arr.length; i++) r += CNK[arr[i]][i + 1];
  return r;
}

/** Inverse of comboRank; returns ascending positions. */
export function comboUnrank(rank, k, n, out) {
  const arr = out || new Array(k);
  let r = rank;
  for (let i = k - 1; i >= 0; i--) {
    let p = i;
    while (p + 1 < n && CNK[p + 1][i + 1] <= r) p++;
    arr[i] = p;
    r -= CNK[p][i + 1];
  }
  return arr;
}

/* ====================================================================== *
 * Coordinate encode / decode
 * ====================================================================== */

const SLICE_IDX = 8; // cubies 8..11 are the FR FL BL BR (UD-slice) edges

/** corner orientation -> 0..2186 (the 8th corner is implied) */
export function getTwist(co) {
  let t = 0;
  for (let i = 6; i >= 0; i--) t = t * 3 + co[i];
  return t;
}

export function setTwist(t, co) {
  let s = 0;
  for (let i = 0; i < 7; i++) {
    const d = t % 3;
    t = (t - d) / 3;
    co[i] = d;
    s += d;
  }
  co[7] = (3 - (s % 3)) % 3;
}

/** edge orientation -> 0..2047 */
export function getFlip(eo) {
  let f = 0;
  for (let i = 10; i >= 0; i--) f = f * 2 + eo[i];
  return f;
}

export function setFlip(f, eo) {
  let s = 0;
  for (let i = 0; i < 11; i++) {
    const b = f & 1;
    f >>= 1;
    eo[i] = b;
    s += b;
  }
  eo[11] = s & 1;
}

const tmpPos = new Int32Array(4);
const tmpPos2 = new Int32Array(4);

/**
 * Which slots hold a UD-slice edge. The mirroring below makes the solved
 * cube (slice edges on slots 8,9,10,11) rank 0 instead of C(12,4)-1.
 */
export function getSlice1(ep) {
  let k = 0;
  for (let j = 0; j < 12; j++) if (ep[j] >= SLICE_IDX) tmpPos[k++] = j;
  for (let i = 0; i < 4; i++) tmpPos2[i] = 11 - tmpPos[3 - i];
  return comboRank(tmpPos2);
}

export function setSlice1(idx, ep) {
  const q = comboUnrank(idx, 4, 12);
  const p0 = 11 - q[3], p1 = 11 - q[2], p2 = 11 - q[1], p3 = 11 - q[0];
  let a = SLICE_IDX, b = 0;
  for (let j = 0; j < 12; j++) {
    ep[j] = (j === p0 || j === p1 || j === p2 || j === p3) ? a++ : b++;
  }
  return ep;
}

export function getCP(cp) { return permRank(cp); }
export function setCP(r, cp) { return permUnrank(r, 8, cp); }

/** permutation of the 8 U/D edges within slots 0..7 */
export function getEP8(ep) {
  let rank = 0;
  for (let i = 0; i < 8; i++) {
    let c = 0;
    for (let j = i + 1; j < 8; j++) if (ep[j] < ep[i]) c++;
    rank += c * FACT[7 - i];
  }
  return rank;
}

export function setEP8(rank, ep) {
  const avail = [0, 1, 2, 3, 4, 5, 6, 7];
  let r = rank;
  for (let i = 0; i < 8; i++) {
    const f = FACT[7 - i];
    const idx = Math.floor(r / f);
    r -= idx * f;
    ep[i] = avail.splice(idx, 1)[0];
  }
}

const spArr = new Int32Array(4);

/** permutation of the 4 slice edges within slots 8..11 */
export function getSP(ep) {
  spArr[0] = ep[8] - 8; spArr[1] = ep[9] - 8;
  spArr[2] = ep[10] - 8; spArr[3] = ep[11] - 8;
  return permRank(spArr);
}

export function setSP(rank, ep) {
  const p = permUnrank(rank, 4);
  ep[8] = p[0] + 8; ep[9] = p[1] + 8;
  ep[10] = p[2] + 8; ep[11] = p[3] + 8;
}

/* ====================================================================== *
 * Move tables
 * ====================================================================== */

export const N_TWIST = 2187;
export const N_FLIP = 2048;
export const N_SLICE1 = 495;
export const N_CP = 40320;
export const N_EP8 = 40320;
export const N_SP = 24;
export const N_MOVES1 = 18;
export const N_MOVES2 = 10;

/** Phase-1 move list: every face x {1, 2, 3}. */
export const MOVES1 = [];
for (let f = 0; f < 6; f++) for (let a = 1; a <= 3; a++) MOVES1.push({ face: f, amount: a });

/**
 * Phase-2 move set, as indices into MOVES1.
 * MOVES1 order is U U2 U' | R R2 R' | F F2 F' | D D2 D' | L L2 L' | B B2 B'
 *   -> indices   0  1  2    3  4  5    6  7  8    9 10 11   12 13 14   15 16 17
 * Phase 2 allows only U*, D* and the half turns R2 F2 L2 B2.
 */
export const MOVES2_IDX = [0, 1, 2, 9, 10, 11, 4, 7, 13, 16];
export const MOVES2 = MOVES2_IDX.map((i) => MOVES1[i]);

const srcC = new Int8Array(8);
const srcE = new Int8Array(12);

function buildTwistMove() {
  const co = new Int8Array(8), nco = new Int8Array(8);
  const t = new Uint16Array(N_TWIST * N_MOVES1);
  for (let v = 0; v < N_TWIST; v++) {
    setTwist(v, co);
    for (let m = 0; m < N_MOVES1; m++) {
      const f = MOVES1[m].face, a = MOVES1[m].amount;
      const mc = MOVE_CP[f], mo = MOVE_CO[f];
      nco.set(co);
      for (let k = 0; k < a; k++) {
        srcC.set(nco);
        for (let i = 0; i < 8; i++) {
          const s = srcC[mc[i]] + mo[i];
          nco[i] = s >= 3 ? s - 3 : s;
        }
      }
      t[v * N_MOVES1 + m] = getTwist(nco);
    }
  }
  return t;
}

function buildFlipMove() {
  const eo = new Int8Array(12), neo = new Int8Array(12);
  const t = new Uint16Array(N_FLIP * N_MOVES1);
  for (let v = 0; v < N_FLIP; v++) {
    setFlip(v, eo);
    for (let m = 0; m < N_MOVES1; m++) {
      const f = MOVES1[m].face, a = MOVES1[m].amount;
      const me = MOVE_EP[f], mx = MOVE_EO[f];
      neo.set(eo);
      for (let k = 0; k < a; k++) {
        srcE.set(neo);
        for (let i = 0; i < 12; i++) neo[i] = (srcE[me[i]] + mx[i]) & 1;
      }
      t[v * N_MOVES1 + m] = getFlip(neo);
    }
  }
  return t;
}

function buildSliceMove() {
  const ep = new Int8Array(12), nep = new Int8Array(12);
  const t = new Uint16Array(N_SLICE1 * N_MOVES1);
  for (let v = 0; v < N_SLICE1; v++) {
    setSlice1(v, ep);
    for (let m = 0; m < N_MOVES1; m++) {
      const f = MOVES1[m].face, a = MOVES1[m].amount;
      const me = MOVE_EP[f];
      nep.set(ep);
      for (let k = 0; k < a; k++) {
        srcE.set(nep);
        for (let i = 0; i < 12; i++) nep[i] = srcE[me[i]];
      }
      t[v * N_MOVES1 + m] = getSlice1(nep);
    }
  }
  return t;
}

function buildCPMove() {
  const cp = new Int8Array(8), ncp = new Int8Array(8);
  const t = new Uint16Array(N_CP * N_MOVES1);
  for (let v = 0; v < N_CP; v++) {
    setCP(v, cp);
    for (let m = 0; m < N_MOVES1; m++) {
      const f = MOVES1[m].face, a = MOVES1[m].amount;
      const mc = MOVE_CP[f];
      ncp.set(cp);
      for (let k = 0; k < a; k++) {
        srcC.set(ncp);
        for (let i = 0; i < 8; i++) ncp[i] = srcC[mc[i]];
      }
      t[v * N_MOVES1 + m] = permRank(ncp);
    }
  }
  return t;
}

function buildEP8Move() {
  const ep = new Int8Array(12), nep = new Int8Array(12);
  const t = new Uint16Array(N_EP8 * N_MOVES2);
  for (let v = 0; v < N_EP8; v++) {
    setEP8(v, ep);
    for (let i = 8; i < 12; i++) ep[i] = i;
    for (let m = 0; m < N_MOVES2; m++) {
      const f = MOVES2[m].face, a = MOVES2[m].amount;
      const me = MOVE_EP[f];
      nep.set(ep);
      for (let k = 0; k < a; k++) {
        srcE.set(nep);
        for (let i = 0; i < 12; i++) nep[i] = srcE[me[i]];
      }
      t[v * N_MOVES2 + m] = getEP8(nep);
    }
  }
  return t;
}

function buildSPMove() {
  const ep = new Int8Array(12), nep = new Int8Array(12);
  const t = new Uint16Array(N_SP * N_MOVES2);
  for (let v = 0; v < N_SP; v++) {
    for (let i = 0; i < 8; i++) ep[i] = i;
    setSP(v, ep);
    for (let m = 0; m < N_MOVES2; m++) {
      const f = MOVES2[m].face, a = MOVES2[m].amount;
      const me = MOVE_EP[f];
      nep.set(ep);
      for (let k = 0; k < a; k++) {
        srcE.set(nep);
        for (let i = 0; i < 12; i++) nep[i] = srcE[me[i]];
      }
      t[v * N_MOVES2 + m] = getSP(nep);
    }
  }
  return t;
}

export function buildMoveTables() {
  return {
    twistMove: buildTwistMove(),
    flipMove: buildFlipMove(),
    sliceMove: buildSliceMove(),
    cpMove: buildCPMove(),
    ep8Move: buildEP8Move(),
    spMove: buildSPMove(),
  };
}
