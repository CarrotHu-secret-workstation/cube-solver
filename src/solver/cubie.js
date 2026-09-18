/**
 * Cubie-level model of the 3x3x3 Rubik's cube (Kociemba representation).
 *
 * Corner positions: URF UFL ULB UBR DFR DLF DBL DRB   (0..7)
 * Edge positions:   UR UF UL UB DR DF DL DB FR FL BL BR (0..11)
 * Facelet order:    U(0-8) R(9-17) F(18-26) D(27-35) L(36-44) B(45-53)
 * Colors:           U=0 R=1 F=2 D=3 L=4 B=5
 *
 * A cube state is { cp, co, ep, eo } of Int8Array:
 *   cp[i] = which corner cubie sits in corner position i
 *   co[i] = its orientation (0..2)
 *   ep[i] = which edge cubie sits in edge position i
 *   eo[i] = its orientation (0..1)
 *
 * Move tables below give, for each target position i, the SOURCE position
 * that lands there, plus the orientation delta. This matches Kociemba's
 * convention: result.cp[i] = state.cp[MOVE_CP[f][i]]
 */

export const U = 0, R = 1, F = 2, D = 3, L = 4, B = 5;
export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
export const COLOR_CHARS = 'URFDLB';

/* corner cubie -> its three facelets (U/R/F order of the cubie) */
export const CORNER_FACELET = [
  [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
  [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
];

export const CORNER_COLOR = [
  [U, R, F], [U, F, L], [U, L, B], [U, B, R],
  [D, F, R], [D, L, F], [D, B, L], [D, R, B],
];

export const EDGE_FACELET = [
  [5, 10], [7, 19], [3, 37], [1, 46],
  [32, 16], [28, 25], [30, 43], [34, 52],
  [23, 12], [21, 41], [50, 39], [48, 14],
];

export const EDGE_COLOR = [
  [U, R], [U, F], [U, L], [U, B],
  [D, R], [D, F], [D, L], [D, B],
  [F, R], [F, L], [B, L], [B, R],
];

/* ---------------- base move tables (source position per target slot) ---- */

export const MOVE_CP = [
  [3, 0, 1, 2, 4, 5, 6, 7],
  [4, 1, 2, 0, 7, 5, 6, 3],
  [1, 5, 2, 3, 0, 4, 6, 7],
  [0, 1, 2, 3, 5, 6, 7, 4],
  [0, 2, 6, 3, 4, 1, 5, 7],
  [0, 1, 3, 7, 4, 5, 2, 6],
];

export const MOVE_CO = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [2, 0, 0, 1, 1, 0, 0, 2],
  [1, 2, 0, 0, 2, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 2, 0, 0, 2, 1, 0],
  [0, 0, 1, 2, 0, 0, 2, 1],
];

export const MOVE_EP = [
  [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11],
  [8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10, 0],
  [0, 9, 2, 3, 4, 8, 6, 7, 1, 5, 10, 11],
  [0, 1, 2, 3, 5, 6, 7, 4, 8, 9, 10, 11],
  [0, 1, 10, 3, 4, 5, 9, 7, 8, 2, 6, 11],
  [0, 1, 2, 11, 4, 5, 6, 10, 8, 9, 3, 7],
];

export const MOVE_EO = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1],
];

/* ---------------- state helpers ----------------------------------------- */

export function solvedCube() {
  return {
    cp: Int8Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
    co: new Int8Array(8),
    ep: Int8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    eo: new Int8Array(12),
  };
}

export function cloneCube(s) {
  return {
    cp: Int8Array.from(s.cp),
    co: Int8Array.from(s.co),
    ep: Int8Array.from(s.ep),
    eo: Int8Array.from(s.eo),
  };
}

/** Apply one base face turn (face 0..5, amount 1=quarter, 2=half, 3=inverse). */
export function applyFace(s, face, amount) {
  const n = ((amount % 4) + 4) % 4;
  for (let k = 0; k < n; k++) applyQuarter(s, face);
  return s;
}

function applyQuarter(s, f) {
  const mc = MOVE_CP[f], mo = MOVE_CO[f];
  const me = MOVE_EP[f], mx = MOVE_EO[f];
  const cp = new Int8Array(8), co = new Int8Array(8);
  const ep = new Int8Array(12), eo = new Int8Array(12);
  for (let i = 0; i < 8; i++) {
    const src = mc[i];
    cp[i] = s.cp[src];
    let o = s.co[src] + mo[i];
    co[i] = o >= 3 ? o - 3 : o;
  }
  for (let i = 0; i < 12; i++) {
    const src = me[i];
    ep[i] = s.ep[src];
    eo[i] = (s.eo[src] + mx[i]) & 1;
  }
  s.cp = cp; s.co = co; s.ep = ep; s.eo = eo;
}

/* ---------------- move notation ---------------------------------------- */

export const MOVE_NAMES = [];
for (let f = 0; f < 6; f++) {
  MOVE_NAMES.push(FACES[f]);
  MOVE_NAMES.push(FACES[f] + '2');
  MOVE_NAMES.push(FACES[f] + "'");
}

/** Parse one token such as U, R2, F' into { face, amount } or null. */
export function parseMove(tok) {
  if (!tok) return null;
  const f = FACES.indexOf(tok[0].toUpperCase());
  if (f < 0) return null;
  const suf = tok.slice(1).trim();
  if (suf === '' || suf === '1') return { face: f, amount: 1 };
  if (suf === '2') return { face: f, amount: 2 };
  if (suf === "'" || suf === '3' || suf === 'i') return { face: f, amount: 3 };
  return null;
}

export function parseAlg(str) {
  const out = [];
  for (const tok of String(str).trim().split(/\s+/)) {
    const m = parseMove(tok);
    if (m) out.push(m);
  }
  return out;
}

export function applyAlg(cube, alg) {
  const list = typeof alg === 'string' ? parseAlg(alg) : alg;
  for (const m of list) applyFace(cube, m.face, m.amount);
  return cube;
}

export function algToString(alg) {
  return alg.map((m) => FACES[m.face] + (m.amount === 1 ? '' : m.amount === 2 ? '2' : "'")).join(' ');
}

/* ---------------- facelets <-> cubie ----------------------------------- */

/** Build the 54-char facelet string (U R F D L B order) from a cubie state. */
export function toFacelets(s) {
  const f = new Array(54).fill('?');
  for (let i = 0; i < 6; i++) f[i * 9 + 4] = COLOR_CHARS[i];
  for (let i = 0; i < 8; i++) {
    const p = s.cp[i], o = s.co[i];
    for (let k = 0; k < 3; k++) f[CORNER_FACELET[i][(k + o) % 3]] = COLOR_CHARS[CORNER_COLOR[p][k]];
  }
  for (let i = 0; i < 12; i++) {
    const p = s.ep[i], o = s.eo[i];
    for (let k = 0; k < 2; k++) f[EDGE_FACELET[i][(k + o) % 2]] = COLOR_CHARS[EDGE_COLOR[p][k]];
  }
  return f.join('');
}

/** Parse a 54-char facelet string into a cubie state (null if malformed). */
export function fromFacelets(str) {
  const s = String(str).toUpperCase().replace(/\s+/g, '');
  if (s.length !== 54) return null;
  const idx = (col) => COLOR_CHARS.indexOf(col);
  const out = solvedCube();
  for (let i = 0; i < 8; i++) {
    const cols = CORNER_FACELET[i].map((fi) => idx(s[fi]));
    let found = -1, ori = 0;
    for (let c = 0; c < 8; c++) {
      for (let o = 0; o < 3; o++) {
        if (CORNER_COLOR[c][0] === cols[o] &&
            CORNER_COLOR[c][1] === cols[(o + 1) % 3] &&
            CORNER_COLOR[c][2] === cols[(o + 2) % 3]) { found = c; ori = o; }
      }
    }
    if (found < 0) return null;
    out.cp[i] = found; out.co[i] = ori;
  }
  for (let i = 0; i < 12; i++) {
    const cols = EDGE_FACELET[i].map((fi) => idx(s[fi]));
    let found = -1, ori = 0;
    for (let c = 0; c < 12; c++) {
      if (EDGE_COLOR[c][0] === cols[0] && EDGE_COLOR[c][1] === cols[1]) { found = c; ori = 0; }
      else if (EDGE_COLOR[c][0] === cols[1] && EDGE_COLOR[c][1] === cols[0]) { found = c; ori = 1; }
    }
    if (found < 0) return null;
    out.ep[i] = found; out.eo[i] = ori;
  }
  return out;
}

/* ---------------- validation -------------------------------------------- */

/** Returns null when the cubie state is solvable, else a reason string. */
export function validate(s) {
  const seenC = new Set(), seenE = new Set();
  for (let i = 0; i < 8; i++) { if (seenC.has(s.cp[i])) return 'duplicate corner'; seenC.add(s.cp[i]); }
  for (let i = 0; i < 12; i++) { if (seenE.has(s.ep[i])) return 'duplicate edge'; seenE.add(s.ep[i]); }
  let sc = 0; for (let i = 0; i < 8; i++) sc += s.co[i];
  if (sc % 3 !== 0) return 'corner twist';
  let se = 0; for (let i = 0; i < 12; i++) se += s.eo[i];
  if (se % 2 !== 0) return 'edge flip';
  let par = 0;
  for (let i = 7; i > 0; i--) for (let j = i - 1; j >= 0; j--) if (s.cp[j] > s.cp[i]) par++;
  for (let i = 11; i > 0; i--) for (let j = i - 1; j >= 0; j--) if (s.ep[j] > s.ep[i]) par++;
  if (par % 2 !== 0) return 'permutation parity';
  return null;
}

export function isSolved(s) {
  return toFacelets(s) === SOLVED_FACELETS;
}

export const SOLVED_FACELETS = toFacelets(solvedCube());

export function randomScramble(len = 20, rng = Math.random) {
  const moves = [];
  let lastFace = -1, lastLast = -1;
  while (moves.length < len) {
    const f = Math.floor(rng() * 6);
    if (f === lastFace) continue;
    const isOpposite = lastFace >= 0 && OPPOSITE[f] === lastFace;
    if (isOpposite && f === lastLast) continue;
    const amount = 1 + Math.floor(rng() * 3);
    moves.push({ face: f, amount });
    lastLast = lastFace; lastFace = f;
  }
  return moves;
}

export const OPPOSITE = [D, L, B, U, R, F];
