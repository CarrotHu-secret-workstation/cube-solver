/**
 * Kociemba two-phase search.
 *
 * Phase 1 drives the cube into G1 = <U, D, R2, F2, L2, B2> by solving
 * (twist, flip, slice1) to (0, 0, 0).
 * Phase 2 solves (cp, ep8, sp) to (0, 0, 0) using only the 10 G1 moves.
 *
 * Both phases are iterative-deepening DFS with admissible pruning from exact
 * distance tables, and both are bounded by a wall-clock deadline so the solver
 * can never hang.
 */

import {
  N_MOVES1, N_MOVES2, N_SLICE1, N_SP,
  MOVES1, MOVES2, MOVES2_IDX,
  getTwist, getFlip, getSlice1, getCP, getEP8, getSP,
  buildMoveTables,
} from './coordinates.js';
import { buildPruningTables } from './tables.js';
import { solvedCube, applyFace, cloneCube } from './cubie.js';

let TABLES = null;
let MT = null;

/** Build (and cache) the move and pruning tables. */
export function ensureTables(onProgress) {
  if (TABLES) return TABLES;
  const t0 = Date.now();
  MT = buildMoveTables();
  TABLES = buildPruningTables(MT);
  TABLES.buildMs = Date.now() - t0;
  if (onProgress) onProgress('tables ready in ' + TABLES.buildMs + ' ms');
  return TABLES;
}

/** face -> axis: U/D = 0, R/L = 1, F/B = 2. */
const AXIS = [0, 1, 2, 0, 1, 2];

/** God's number for phase 2 is 18, so this bounds the phase-2 IDA*. */
export const MAX_PHASE2 = 18;

/** God's number for phase 1 is 12. */
export const MAX_PHASE1 = 12;

export function createSolver(opts = {}) {
  ensureTables();
  const mt = MT;
  const prun = TABLES;
  const { twistMove, flipMove, sliceMove, cpMove, ep8Move, spMove } = mt;
  const { flipSlice, twistSlice, cpSlice, ep8Slice } = prun;

  const DEFAULT = {
    maxDepth: 26,
    maxPhase1: MAX_PHASE1,
    maxSolutions: 40,   // phase-1 G1 leaves to try before giving up on shortening
    maxTimeMs: 3000,
    ...opts,
  };

  return function solve(cube, options = {}) {
    const o = { ...DEFAULT, ...options };
    const deadline = Date.now() + o.maxTimeMs;
    const expired = () => Date.now() > deadline;

    const tw0 = getTwist(cube.co), fl0 = getFlip(cube.eo), sl0 = getSlice1(cube.ep);

    /* ------------------------------------------------------------------ *
     * Phase 2: solve (cp, ep8, sp) inside G1.
     * ------------------------------------------------------------------ */
    const p2moves = new Int32Array(MAX_PHASE2 + 1);

    function h2(cp, ep8v, sp) {
      const a = cpSlice[cp * N_SP + sp];
      const b = ep8Slice[ep8v * N_SP + sp];
      return a > b ? a : b;
    }

    function phase2(cp0, ep80, sp0, maxLen, out) {
      if (cp0 === 0 && ep80 === 0 && sp0 === 0) return 0;
      const cap = Math.min(maxLen, MAX_PHASE2);

      function dfs(cp, ep8v, sp, depth, limit, lastFace, lastAxis) {
        if (expired()) return false;
        if (h2(cp, ep8v, sp) > limit - depth) return false;
        if (depth === limit) return cp === 0 && ep8v === 0 && sp === 0;

        for (let m = 0; m < N_MOVES2; m++) {
          const face = MOVES2[m].face;
          const ax = AXIS[face];
          if (face === lastFace) continue;
          if (depth > 0 && ax === lastAxis) continue;

          const ncp = cpMove[cp * N_MOVES1 + MOVES2_IDX[m]];
          const nep = ep8Move[ep8v * N_MOVES2 + m];
          const nsp = spMove[sp * N_MOVES2 + m];
          p2moves[depth] = m;
          if (dfs(ncp, nep, nsp, depth + 1, limit, face, ax)) return true;
        }
        return false;
      }

      for (let limit = h2(cp0, ep80, sp0); limit <= cap; limit++) {
        if (dfs(cp0, ep80, sp0, 0, limit, -1, -1)) {
          for (let i = 0; i < limit; i++) out.push(MOVES2[p2moves[i]]);
          return limit;
        }
        if (expired()) return null;
      }
      return null;
    }

    /* Already in G1: phase 2 alone is enough. */
    if (tw0 === 0 && fl0 === 0 && sl0 === 0) {
      const out = [];
      const r = phase2(getCP(cube.cp), getEP8(cube.ep), getSP(cube.ep), o.maxDepth, out);
      if (r === null) return null;
      return { moves: out, length: out.length, phase1: 0, phase2: out.length };
    }

    /* ------------------------------------------------------------------ *
     * Phase 1: reach G1, then finish with phase 2.
     * ------------------------------------------------------------------ */
    const p1moves = new Int32Array(o.maxPhase1 + 1);
    const scratch = cloneCube(cube);   // reused for replaying phase-1 paths
    let best = null;
    let aborted = false;
    let found = 0;

    /** Replay the recorded phase-1 path on the INPUT cube, then run phase 2. */
    function tryAt(len) {
      scratch.cp.set(cube.cp); scratch.co.set(cube.co);
      scratch.ep.set(cube.ep); scratch.eo.set(cube.eo);
      for (let i = 0; i < len; i++) {
        const mv = MOVES1[p1moves[i]];
        applyFace(scratch, mv.face, mv.amount);
      }
      const rest = Math.min(o.maxDepth - len, MAX_PHASE2);
      if (rest < 0) return;

      const p2 = [];
      if (phase2(getCP(scratch.cp), getEP8(scratch.ep), getSP(scratch.ep), rest, p2) === null) return;

      const total = [];
      for (let i = 0; i < len; i++) total.push(MOVES1[p1moves[i]]);
      for (const m of p2) total.push(m);
      if (!best || total.length < best.length) {
        best = { moves: total, length: total.length, phase1: len, phase2: p2.length };
      }
    }

    function dfsP1(tw, fl, sl, depth, limit, lastFace, lastAxis) {
      if (aborted) return true;
      if (expired()) { aborted = true; return true; }

      if (depth === limit) {
        if (tw === 0 && fl === 0 && sl === 0) {
          found++;
          tryAt(depth);
        }
        return found >= o.maxSolutions;
      }

      const a = flipSlice[fl * N_SLICE1 + sl];
      const b = twistSlice[tw * N_SLICE1 + sl];
      if ((a > b ? a : b) > limit - depth) return false;

      for (let m = 0; m < N_MOVES1; m++) {
        const face = MOVES1[m].face;
        const ax = AXIS[face];
        if (face === lastFace) continue;
        if (depth > 0 && ax === lastAxis) continue;

        const ntw = twistMove[tw * N_MOVES1 + m];
        const nfl = flipMove[fl * N_MOVES1 + m];
        const nsl = sliceMove[sl * N_MOVES1 + m];
        p1moves[depth] = m;
        if (dfsP1(ntw, nfl, nsl, depth + 1, limit, face, ax)) return true;
      }
      return false;
    }

    for (let limit = 0; limit <= o.maxPhase1; limit++) {
      found = 0;
      if (dfsP1(tw0, fl0, sl0, 0, limit, -1, -1)) break;
      /* a longer phase 1 cannot beat the current best total */
      if (best && best.length <= limit + 1) break;
      if (aborted) break;
    }

    return best;
  };
}

/** Convenience: solve one cube with a freshly built solver. */
export function solveCube(cube, opts) {
  return createSolver(opts)(cube, opts);
}
