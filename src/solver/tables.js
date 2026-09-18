/**
 * Kociemba pruning tables.
 *
 * Phase 1 (heuristic on twist/flip/slice1, goal 0,0,0):
 *   flipSlicePrun : min moves to solve (flip, slice1)   [2048 x 495 = 1,013,760]
 *   twistSlicePrun: min moves to solve (twist, slice1)  [2187 x 495 = 1,082,565]
 *   twistFlipPrun : min moves to solve (twist, flip)    [2187 x 2048 = 4,478,976]
 *
 * Phase 2 (heuristic on cp/ep8/sp, goal 0,0,0):
 *   cpSlice2Prun  : min moves to solve (cp, sp)   [40320 x 24 = 967,680]
 *   ep8Slice2Prun : min moves to solve (ep8, sp)  [40320 x 24 = 967,680]
 *
 * All tables are filled with a breadth-first backward search from the goal
 * (BFS over the move group, so the table is an exact distance, capped at 15).
 */

import {
  N_TWIST, N_FLIP, N_SLICE1, N_CP, N_EP8, N_SP, N_MOVES1, N_MOVES2,
  MOVES2_IDX, buildMoveTables, getSlice1, setSlice1,
} from './coordinates.js';

/* ---------------- phase 1 ---------------------------------------------- */

function fillFlipSlice(mt) {
  const { flipMove, sliceMove } = mt;
  const size = N_FLIP * N_SLICE1;
  const dist = new Uint8Array(size).fill(0xff);
  dist[0] = 0;
  let frontier = [0];
  let depth = 0;
  while (frontier.length) {
    const next = [];
    depth++;
    for (const s of frontier) {
      const fl = (s / N_SLICE1) | 0;
      const sl = s % N_SLICE1;
      for (let m = 0; m < N_MOVES1; m++) {
        const nf = flipMove[fl * N_MOVES1 + m];
        const ns = sliceMove[sl * N_MOVES1 + m];
        const t = nf * N_SLICE1 + ns;
        if (dist[t] === 0xff) { dist[t] = depth; next.push(t); }
      }
    }
    frontier = next;
  }
  return dist;
}

function fillTwistSlice(mt) {
  const { twistMove, sliceMove } = mt;
  const size = N_TWIST * N_SLICE1;
  const dist = new Uint8Array(size).fill(0xff);
  dist[0] = 0;
  let frontier = [0];
  let depth = 0;
  while (frontier.length) {
    const next = [];
    depth++;
    for (const s of frontier) {
      const tw = (s / N_SLICE1) | 0;
      const sl = s % N_SLICE1;
      for (let m = 0; m < N_MOVES1; m++) {
        const nt = twistMove[tw * N_MOVES1 + m];
        const ns = sliceMove[sl * N_MOVES1 + m];
        const u = nt * N_SLICE1 + ns;
        if (dist[u] === 0xff) { dist[u] = depth; next.push(u); }
      }
    }
    frontier = next;
  }
  return dist;
}

/* ---------------- phase 2 ---------------------------------------------- */

function fillCPSlice(mt) {
  const { cpMove, spMove } = mt;
  const size = N_CP * N_SP;
  const dist = new Uint8Array(size).fill(0xff);
  dist[0] = 0;
  let frontier = [0];
  let depth = 0;
  while (frontier.length) {
    const next = [];
    depth++;
    for (const s of frontier) {
      const cp = (s / N_SP) | 0;
      const sp = s % N_SP;
      for (let m = 0; m < N_MOVES2; m++) {
        const ncp = cpMove[cp * N_MOVES1 + MOVES2_IDX[m]];
        const nsp = spMove[sp * N_MOVES2 + m];
        const t = ncp * N_SP + nsp;
        if (dist[t] === 0xff) { dist[t] = depth; next.push(t); }
      }
    }
    frontier = next;
  }
  return dist;
}

function fillEP8Slice(mt) {
  const { ep8Move, spMove } = mt;
  const size = N_EP8 * N_SP;
  const dist = new Uint8Array(size).fill(0xff);
  dist[0] = 0;
  let frontier = [0];
  let depth = 0;
  while (frontier.length) {
    const next = [];
    depth++;
    for (const s of frontier) {
      const ep = (s / N_SP) | 0;
      const sp = s % N_SP;
      for (let m = 0; m < N_MOVES2; m++) {
        const nep = ep8Move[ep * N_MOVES2 + m];
        const nsp = spMove[sp * N_MOVES2 + m];
        const t = nep * N_SP + nsp;
        if (dist[t] === 0xff) { dist[t] = depth; next.push(t); }
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * Phase-1 heuristic: max of the three tables, which is admissible because
 * each is a lower bound on the remaining number of phase-1 moves.
 */
export function buildPruningTables(mt) {
  return {
    flipSlice: fillFlipSlice(mt),
    twistSlice: fillTwistSlice(mt),
    cpSlice: fillCPSlice(mt),
    ep8Slice: fillEP8Slice(mt),
  };
}
