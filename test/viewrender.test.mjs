/**
 * Ground-truth rendering test.
 *
 * The earlier audit compared the material that setFacelets *chose* against the
 * model — self-consistent, and therefore blind to the real defect: after a
 * turn, does the sticker mesh ACTUALLY VISIBLE at world face w carry the right
 * colour, and does a mesh even exist there?
 *
 * This builds the cubies from real three.js objects (groups + sticker meshes,
 * exactly like CubeView.build), applies turns with the real helpers, then walks
 * the scene graph to find which mesh physically faces each visible direction.
 *
 * Two modes are compared:
 *   CURRENT - g.quaternion.identity()   (what the view does today)
 *   FIXED   - g.quaternion.premultiply(turn)
 */
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import { advanceSlot, facePermutation, turnQuarter, visibleFaces, faceletIndex } from '../src/ui/cube3d.js';
import { FACE_AXIS, FACE_LAYER, FACE_NORMAL, FACE_COLORS_HEX } from '../src/ui/facemeta.js';
import { solvedCube, toFacelets, randomScramble, applyFace, FACES } from '../src/solver/cubie.js';

const AXIS_VEC = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const PALETTE = FACE_COLORS_HEX;

function build() {
  const root = new THREE.Group();
  const cubies = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const g = new THREE.Group();
    const mats = new Array(6).fill(null);
    for (const face of visibleFaces(x, y, z)) {
      const mat = new THREE.MeshBasicMaterial({ color: PALETTE[face] });
      const st = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), mat);
      const n = FACE_NORMAL[face];
      st.position.set(n[0] * 0.485, n[1] * 0.485, n[2] * 0.485);
      st.lookAt(n[0] * 3, n[1] * 3, n[2] * 3);
      g.add(st);
      mats[face] = mat;
    }
    g.position.set(x, y, z);
    g.userData = { home: [x, y, z], pos: [x, y, z], ori: [0, 1, 2, 3, 4, 5], mats };
    root.add(g);
    cubies.push(g);
  }
  return { root, cubies };
}

function applyMove(cubies, face, amount, rotateGeometry) {
  const k = FACE_AXIS[face];
  const q = turnQuarter(face, amount);
  const P = facePermutation(k, q);
  const layer = FACE_LAYER[face];
  const qTurn = new THREE.Quaternion().setFromAxisAngle(AXIS_VEC[k], q * Math.PI / 2);
  for (const g of cubies) {
    if (g.userData.pos[k] !== layer) continue;
    const next = advanceSlot(g.userData.pos, k, q);
    g.userData.pos = next;
    const ori = g.userData.ori;
    const nOri = new Array(6);
    for (let w = 0; w < 6; w++) nOri[P[w]] = ori[w];
    g.userData.ori = nOri;
    g.position.set(next[0], next[1], next[2]);
    if (rotateGeometry) g.quaternion.premultiply(qTurn);
    else g.quaternion.identity();
  }
}

/** Which world face does this sticker mesh actually face right now? */
function stickerWorldFace(st) {
  const q = st.getWorldQuaternion(new THREE.Quaternion());
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  let best = -1, bestDot = 0.5;
  for (let f = 0; f < 6; f++) {
    const fn = FACE_NORMAL[f];
    const d = n.x * fn[0] + n.y * fn[1] + n.z * fn[2];
    if (d > bestDot) { bestDot = d; best = f; }
  }
  return best;
}

function paint(cubies, fl) {
  for (const g of cubies) {
    const { pos, ori, mats } = g.userData;
    for (const w of visibleFaces(pos[0], pos[1], pos[2])) {
      const mat = mats[ori[w]];
      if (!mat) continue;
      const idx = 'URFDLB'.indexOf(fl[faceletIndex(pos[0], pos[1], pos[2], w)]);
      mat.color.setHex(idx >= 0 ? PALETTE[idx] : 0x505050);
    }
  }
}

function audit(cubies, fl, root) {
  root.updateMatrixWorld(true);
  let holes = 0, wrong = 0, checks = 0;
  const samples = [];
  for (const g of cubies) {
    const { pos } = g.userData;
    const here = new Map();
    for (const child of g.children) {
      if (!child.isMesh) continue;
      const wf = stickerWorldFace(child);
      if (wf >= 0) here.set(wf, child);
    }
    for (const w of visibleFaces(pos[0], pos[1], pos[2])) {
      checks++;
      const idx = 'URFDLB'.indexOf(fl[faceletIndex(pos[0], pos[1], pos[2], w)]);
      const want = PALETTE[idx];
      const st = here.get(w);
      if (!st) { holes++; if (samples.length < 4) samples.push({ kind: 'hole', pos, w, want: want.toString(16) }); continue; }
      if (st.material.color.getHex() !== want) {
        wrong++;
        if (samples.length < 4) samples.push({ kind: 'wrong', pos, w, got: st.material.color.getHex().toString(16), want: want.toString(16) });
      }
    }
  }
  return { holes, wrong, checks, samples };
}

function parseMove(tok) {
  const f = FACES.indexOf(tok[0]);
  const amt = tok.length > 1 ? (tok[1] === '2' ? 2 : 3) : 1;
  return { face: f, amount: amt };
}

function run(rotateGeometry, label) {
  const seqs = [
    ['U', 'U'], ['R', 'R'], ['F', 'F'], ["U'", "U'"], ["R'", "R'"], ["D'", "D'"],
    ['U R', 'U R'], ["R U R' U'", "R U R' U'"], ['random', null], ['random2', null],
  ];
  const out = [];
  for (const [name, alg] of seqs) {
    const { root, cubies } = build();
    const model = solvedCube();
    if (alg) {
      for (const tok of alg.split(/\s+/)) {
        const m = parseMove(tok);
        applyMove(cubies, m.face, m.amount, rotateGeometry);
        applyFace(model, m.face, m.amount);
      }
    } else {
      for (const m of randomScramble(20)) {
        applyMove(cubies, m.face, m.amount, rotateGeometry);
        applyFace(model, m.face, m.amount);
      }
    }
    paint(cubies, toFacelets(model));
    const a = audit(cubies, toFacelets(model), root);
    out.push({ name, holes: a.holes, wrong: a.wrong, checks: a.checks, samples: a.samples });
  }
  const holes = out.reduce((s, r) => s + r.holes, 0);
  const wrong = out.reduce((s, r) => s + r.wrong, 0);
  console.log(label + ': holes=' + holes + ' wrong=' + wrong + ' over ' + out.length + ' sequences');
  for (const r of out) {
    if (r.holes || r.wrong) console.log('   ' + r.name + ' holes=' + r.holes + ' wrong=' + r.wrong + ' ' + JSON.stringify(r.samples.slice(0, 2)));
  }
  return { holes, wrong, out };
}

const before = run(false, 'CURRENT (quaternion.identity)');
const after = run(true, 'FIXED   (premultiply turn)');
writeFileSync(new URL('./viewrender-report.json', import.meta.url), JSON.stringify({ before, after }, null, 2));
process.exit(after.holes === 0 && after.wrong === 0 ? 0 : 1);
