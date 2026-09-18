/**
 * Verify the drag -> layer-turn mapping.
 *
 * Two properties are asserted, both from the user's point of view:
 *   (a) dragging on face F turns layer F            (predictable face choice)
 *   (b) the grabbed sticker travels with the finger (the core gesture feel)
 * A minimal JSON report is written so results survive the terminal.
 */
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import { resolveDrag } from '../src/ui/pointer.js';
import { FACE_NORMAL } from '../src/ui/facemeta.js';
import { turnQuarter, rotVec } from '../src/ui/cube3d.js';
import { applyFace, solvedCube, validate } from '../src/solver/cubie.js';

const FACE_AXIS = [1, 0, 2, 1, 0, 2];
const FACE_LAYER = [1, 1, 1, -1, -1, -1];

const cam = new THREE.PerspectiveCamera(42, 4 / 3, 0.1, 200);
const TH = Math.PI * 0.28, PH = Math.PI * 0.32, RAD = 9.6;
const camPos = new THREE.Vector3(
  RAD * Math.sin(PH) * Math.sin(TH), RAD * Math.cos(PH), RAD * Math.sin(PH) * Math.cos(TH));
cam.position.copy(camPos); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true);
const W = 900, H = 640;
const projector = (gp) => {
  const p0 = gp.clone().project(cam);
  return (v) => {
    const p1 = gp.clone().add(v.clone().multiplyScalar(0.5)).project(cam);
    return { x: (p1.x - p0.x) * 0.5 * W, y: -(p1.y - p0.y) * 0.5 * H };
  };
};
const displacement = (gl, cp, mv) => {
  const ax = FACE_AXIS[mv.face];
  if (cp[ax] !== FACE_LAYER[mv.face]) return new THREE.Vector3(0, 0, 0);
  return rotVec(gl, ax, turnQuarter(mv.face, mv.amount)).sub(gl);
};
const facing = (f) => new THREE.Vector3(...FACE_NORMAL[f]).dot(camPos.clone().normalize()) > 0.15;

const dirs = [
  { x: 0, y: -70 }, { x: 0, y: 70 }, { x: -70, y: 0 }, { x: 70, y: 0 },
  { x: 50, y: -50 }, { x: -50, y: -50 }, { x: 50, y: 50 }, { x: -50, y: 50 },
];

let tested = 0, resolved = 0, followed = 0, reversed = 0, illegal = 0, wrongFace = 0, degenerate = 0, ambiguous = 0;
const reversedSamples = [], wrongFaceSamples = [], rejectedSamples = [];

for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  const faces = [];
  if (y === 1) faces.push(0); if (x === 1) faces.push(1); if (z === 1) faces.push(2);
  if (y === -1) faces.push(3); if (x === -1) faces.push(4); if (z === -1) faces.push(5);
  for (const face of faces) {
    if (!facing(face)) continue;
    const nr = FACE_NORMAL[face];
    const gl = new THREE.Vector3(x, y, z).add(new THREE.Vector3(nr[0], nr[1], nr[2]).multiplyScalar(0.5));
    const proj = projector(gl);
    for (const d of dirs) {
      tested++;
      const mv = resolveDrag(face, gl, [x, y, z], d, proj);
      if (!mv) { rejectedSamples.push(`f${face}(${x},${y},${z}) drag(${d.x},${d.y})`); continue; }
      resolved++;

      if (!(mv.face >= 0 && mv.face <= 5 && [1, 2, 3].includes(mv.amount))) illegal++;
      else {
        const c = solvedCube();
        applyFace(c, mv.face, mv.amount);
        if (validate(c) !== null) illegal++;
      }

      if (mv.face !== face) { wrongFace++; if (wrongFaceSamples.length < 5) wrongFaceSamples.push(`f${face}->f${mv.face}`); }

      /*
       * The grab is degenerate when the point lies ON the rotation axis: that
       * happens only for a face-centre sticker, whose point genuinely does not
       * move during the turn. Such grabs are counted separately -- they must
       * still resolve (to their own face) but cannot satisfy a displacement test.
       */
      const kAx = FACE_AXIS[face];
      const p = [gl.x, gl.y, gl.z];
      const onAxis = Math.abs(p[(kAx + 1) % 3]) < 1e-9 && Math.abs(p[(kAx + 2) % 3]) < 1e-9;
      if (onAxis) {
        degenerate++;
        if (mv.face !== face) { wrongFace++; if (wrongFaceSamples.length < 5) wrongFaceSamples.push(`centre f${face}->f${mv.face}`); }
        continue;
      }

      const ds = proj(displacement(gl, [x, y, z], mv));
      const dot = ds.x * d.x + ds.y * d.y;

      /*
       * How well COULD any turn of this layer follow the drag? A drag that is
       * nearly perpendicular to the only achievable tangent motion (e.g. a
       * horizontal swipe on the F-face's left-middle sticker, whose motion is
       * vertical) is geometrically ambiguous -- no turn can track the finger.
       * We only demand finger-following when such a turn exists.
       */
      const dn = Math.hypot(d.x, d.y) || 1;
      let achievable = 0;
      for (const s of [1, -1]) {
        const dsp = rotVec(gl, FACE_AXIS[face], s).sub(gl);
        const dss = proj(dsp);
        const l = Math.hypot(dss.x, dss.y);
        if (l > 1e-9) achievable = Math.max(achievable, (dss.x * d.x + dss.y * d.y) / (l * dn));
      }
      if (achievable < 0.35) {
        ambiguous++;
        if (mv.face !== face) wrongFace++;
        continue;
      }

      if (dot > 1e-6) followed++;
      else { reversed++; if (reversedSamples.length < 5) reversedSamples.push(`f${face}(${x},${y},${z}) drag(${d.x},${d.y}) -> ${mv.face}/${mv.amount} dot=${dot.toFixed(1)}`); }
    }
  }
}

/* unambiguous single-gesture checks on visible faces */
function one(face, cubie, drag) {
  const nr = FACE_NORMAL[face];
  const g = new THREE.Vector3(cubie[0], cubie[1], cubie[2]).add(new THREE.Vector3(nr[0], nr[1], nr[2]).multiplyScalar(0.5));
  const mv = resolveDrag(face, g, cubie, drag, projector(g));
  return mv ? ('URFDLB'[mv.face] + (mv.amount === 1 ? '' : "'")) : 'null';
}
const spots = [
  ['F face, drag right', 2, [0, 0, 1], { x: 70, y: 0 }],
  ['F face, drag left', 2, [0, 0, 1], { x: -70, y: 0 }],
  ['F face, drag up', 2, [0, 0, 1], { x: 0, y: -70 }],
  ['F face, drag down', 2, [0, 0, 1], { x: 0, y: 70 }],
  ['U face, drag right', 0, [0, 1, 0], { x: 70, y: 0 }],
  ['U face, drag left', 0, [0, 1, 0], { x: -70, y: 0 }],
  ['R face, drag up', 1, [1, 0, 0], { x: 0, y: -70 }],
  ['R face, drag down', 1, [1, 0, 0], { x: 0, y: 70 }],
].map(([label, f, c, d]) => ({ label, got: one(f, c, d) }));

const spotOk = spots.every((s) => s.got[0] === s.label[0]);
const oppositePairs = [
  ['F right/left', 2, [0, 0, 1], { x: 70, y: 0 }, { x: -70, y: 0 }],
  ['F up/down', 2, [0, 0, 1], { x: 0, y: -70 }, { x: 0, y: 70 }],
  ['U right/left', 0, [0, 1, 0], { x: 70, y: 0 }, { x: -70, y: 0 }],
  ['R up/down', 1, [1, 0, 0], { x: 0, y: -70 }, { x: 0, y: 70 }],
];
const pairs = oppositePairs.map(([label, f, c, d1, d2]) => ({ label, a: one(f, c, d1), b: one(f, c, d2) }));
const pairsOk = pairs.every((p) => p.a !== 'null' && p.b !== 'null' && p.a !== p.b && p.a[0] === p.b[0]);

const checks = {
  turnIsAlwaysTheGrabbedFace: wrongFace === 0,
  stickerFollowsTheFinger: reversed === 0 && followed === resolved - degenerate - ambiguous,
  everyMoveIsLegal: illegal === 0,
  grabbableDragsResolve: resolved >= tested * 0.6,
  centreStickersAlsoWork: degenerate > 0,
  spotGesturesPickTheirFace: spotOk,
  oppositeDragsGiveOppositeTurns: pairsOk,
};
const pass = Object.values(checks).filter(Boolean).length;
const fail = Object.values(checks).length - pass;

const report = { pass, fail, tested, resolved, followed, reversed, illegal, wrongFace, degenerate, ambiguous, rejected: tested - resolved,
  checks, reversedSamples, wrongFaceSamples, rejectedSamples: rejectedSamples.slice(0, 8), spots, pairs };
writeFileSync(new URL('./interaction-report.json', import.meta.url), JSON.stringify(report, null, 2));
console.log('INTERACTION pass=' + pass + '/' + (pass + fail) + ' tested=' + tested +
  ' resolved=' + resolved + ' followed=' + followed + ' reversed=' + reversed +
  ' wrongFace=' + wrongFace + ' illegal=' + illegal);
process.exit(fail === 0 ? 0 : 1);
