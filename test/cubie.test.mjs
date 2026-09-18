import {
  solvedCube, applyAlg, applyFace, toFacelets, fromFacelets, SOLVED_FACELETS,
  isSolved, validate, randomScramble, cloneCube, algToString, parseAlg,
} from '../src/solver/cubie.js';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

console.log('solved facelets:', SOLVED_FACELETS);
ok('solved string length 54', SOLVED_FACELETS.length === 54);
ok('fresh cube is solved', isSolved(solvedCube()));

// --- basic identities -------------------------------------------------
ok('U U\' = identity', isSolved(applyAlg(solvedCube(), "U U'")));
ok('U^4 = identity', isSolved(applyAlg(solvedCube(), 'U U U U')));
ok('R^4 = identity', isSolved(applyAlg(solvedCube(), 'R R R R')));
ok('F^4 = identity', isSolved(applyAlg(solvedCube(), 'F F F F')));
ok('L^4 = identity', isSolved(applyAlg(solvedCube(), 'L L L L')));
ok('B^4 = identity', isSolved(applyAlg(solvedCube(), 'B B B B')));
ok('D^4 = identity', isSolved(applyAlg(solvedCube(), 'D D D D')));

// --- inversion of a full sequence -------------------------------------
const seq = "R U R' U' F2 L D' B";
const inv = parseAlg(seq).slice().reverse().map((m) => ({ face: m.face, amount: (4 - m.amount) % 4 }));
const c1 = solvedCube();
applyAlg(c1, seq);
ok('scramble changes cube', !isSolved(c1));
applyAlg(c1, inv);
ok('inverse restores', isSolved(c1));

// --- sexy move has order 6 --------------------------------------------
const s6 = solvedCube();
for (let i = 0; i < 6; i++) applyAlg(s6, "R U R' U'");
ok('(R U R\' U\')^6 = identity', isSolved(s6));
for (let i = 0; i < 5; i++) applyAlg(solvedCube(), "R U R' U'");
const s5 = solvedCube();
for (let i = 0; i < 5; i++) applyAlg(s5, "R U R' U'");
ok('(R U R\' U\')^5 != identity', !isSolved(s5));

// --- known superflip / checkerboard -----------------------------------
const checker = solvedCube();
applyAlg(checker, "M2 E2 S2"); // M/E/S are not supported; skip

// --- facelets round trip ----------------------------------------------
const rand = solvedCube();
applyAlg(rand, randomScramble(25));
const fl = toFacelets(rand);
ok('facelets length 54', fl.length === 54);
const back = fromFacelets(fl);
ok('fromFacelets round trip', back !== null && toFacelets(back) === fl);
ok('round-tripped cubie state solvable', validate(back) === null);

// --- validation catches illegal states ---------------------------------
const dup = cloneCube(solvedCube());
dup.cp[0] = dup.cp[1];
ok('duplicate corner detected', validate(dup) !== null);
const twist = cloneCube(solvedCube());
twist.co[0] = 1;
ok('corner twist detected', validate(twist) !== null);
const flip = cloneCube(solvedCube());
flip.eo[0] = 1;
ok('edge flip detected', validate(flip) !== null);
const swap = cloneCube(solvedCube());
swap.ep[0] = 1; swap.ep[1] = 0;
ok('edge swap parity detected', validate(swap) !== null);

// --- random scrambles are always legal and non-trivial ------------------
let allOk = true;
for (let i = 0; i < 200; i++) {
  const c = solvedCube();
  applyAlg(c, randomScramble(20));
  if (validate(c) !== null || isSolved(c)) { allOk = false; break; }
}
ok('200 random scrambles legal and unsolved', allOk);

// --- algToString / parseAlg round trip ----------------------------------
ok('algToString', algToString(parseAlg("R U2 F'")) === "R U2 F'");

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
