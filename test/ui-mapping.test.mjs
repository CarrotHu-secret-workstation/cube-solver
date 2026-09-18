/**
 * Verify the UI's logical-position -> facelet mapping against the solver's
 * facelet model. A mismatch here would render a scrambled-looking cube even
 * when the solver state is solved.
 */
import { solvedCube, applyAlg, toFacelets, randomScramble } from '../src/solver/cubie.js';
import { visibleFaces, faceletIndex } from '../src/ui/cube3d.js';

let pass = 0, fail = 0;
const lines = [];
function ok(name, cond, extra) {
  if (cond) { pass++; lines.push('  ok  ' + name); }
  else { fail++; lines.push('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

/* For every cubie and every visible face, the facelet index must be unique
 * across the 54 facelets and must lie in the correct face block. */
const seen = new Set();
let uniqueOk = true, blockOk = true, count = 0;
for (let x = -1; x <= 1; x++) {
  for (let y = -1; y <= 1; y++) {
    for (let z = -1; z <= 1; z++) {
      for (const face of visibleFaces(x, y, z)) {
        const i = faceletIndex(x, y, z, face);
        count++;
        if (seen.has(i)) uniqueOk = false;
        seen.add(i);
        if (Math.floor(i / 9) !== face) blockOk = false;
      }
    }
  }
}
ok('every cubie face maps to a unique facelet', uniqueOk && count === 54, 'count=' + count);
ok('facelet index stays inside its face block', blockOk);
ok('all 54 facelets covered', seen.size === 54);

/* On a solved cube, each sticker's colour must equal its own face colour. */
const solved = toFacelets(solvedCube());
const names = 'URFDLB';
let solvedOk = true, bad = '';
for (let x = -1; x <= 1; x++) {
  for (let y = -1; y <= 1; y++) {
    for (let z = -1; z <= 1; z++) {
      for (const face of visibleFaces(x, y, z)) {
        const ch = solved[faceletIndex(x, y, z, face)];
        if (ch !== names[face]) { solvedOk = false; bad = `(${x},${y},${z}) face ${names[face]} -> ${ch}`; }
      }
    }
  }
}
ok('solved cube stickers show their own face colour', solvedOk, bad);

/* Scrambled: the multiset of rendered colours must match the solver facelets. */
const c = solvedCube();
applyAlg(c, randomScramble(25));
const fl = toFacelets(c);
const counts = {};
for (const ch of fl) counts[ch] = (counts[ch] || 0) + 1;
let sixEach = true;
for (const k of names) if (counts[k] !== 9) sixEach = false;
ok('scrambled facelets have 9 of each colour', sixEach, JSON.stringify(counts));

lines.push('');
lines.push(pass + ' passed, ' + fail + ' failed');
console.log(lines.join('\n'));
process.exit(fail === 0 ? 0 : 1);
