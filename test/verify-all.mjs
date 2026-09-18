/**
 * End-to-end verification of the Kociemba solver.
 * Writes a compact one-line summary plus per-case detail to /tmp/verify-all.txt.
 */
import { solvedCube, applyAlg, isSolved, cloneCube, algToString, randomScramble } from '../src/solver/cubie.js';
import { createSolver, ensureTables } from '../src/solver/search.js';
import { writeFileSync } from 'node:fs';

const t0 = Date.now();
ensureTables();
const tableMs = Date.now() - t0;
const solve = createSolver({ maxTimeMs: 3000, maxSolutions: 60, maxPhase1: 12, maxDepth: 24 });

let tested = 0, correct = 0, noSol = 0, maxLen = 0, sumLen = 0, maxMs = 0, sumMs = 0;
const details = [];

function check(label, cube) {
  tested++;
  const t = Date.now();
  const r = solve(cube);
  const ms = Date.now() - t;
  sumMs += ms;
  if (ms > maxMs) maxMs = ms;
  if (!r) { noSol++; details.push('NO_SOLUTION ' + label); return; }
  const c2 = cloneCube(cube);
  applyAlg(c2, r.moves);
  const good = isSolved(c2);
  if (good) {
    correct++;
    sumLen += r.length;
    if (r.length > maxLen) maxLen = r.length;
  } else {
    details.push('WRONG ' + label + ' alg=' + algToString(r.moves));
  }
  details.push(label + ' len=' + r.length + ' ms=' + ms + ' ok=' + good);
}

check('solved', solvedCube());
for (const mv of ['U', "U'", 'U2', 'R', "R'", 'R2', 'F', "F'", 'F2', 'D', "D'", 'D2', 'L', "L'", 'L2', 'B', "B'", 'B2']) {
  const c = solvedCube(); applyAlg(c, mv); check('single:' + mv, c);
}
for (const alg of ['R U', "R U R' U'", 'F2 L2 D', "B2 D2 F2 B2 R2 U' D' L2 B2 D' R2", 'R U2 F', "L' B D2 R2"]) {
  const c = solvedCube(); applyAlg(c, alg); check('alg:' + alg, c);
}
const N = 40;
for (let i = 0; i < N; i++) {
  const c = solvedCube();
  applyAlg(c, randomScramble(20));
  check('rnd:' + i, c);
}

const line = 'RESULT tested=' + tested + ' correct=' + correct + ' noSol=' + noSol +
  ' wrong=' + (tested - correct - noSol) + ' maxLen=' + maxLen +
  ' avgLen=' + (correct ? (sumLen / correct).toFixed(1) : '-') +
  ' avgMs=' + (sumMs / tested).toFixed(0) + ' maxMs=' + maxMs + ' tableMs=' + tableMs;

writeFileSync('/tmp/verify-all.txt', line + '\n\n' + details.join('\n') + '\n');
console.log(line);
process.exit(correct === tested ? 0 : 1);
