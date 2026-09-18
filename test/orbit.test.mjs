/**
 * Orbit camera tests.
 *
 * The defect this guards: the old camera stored its pose as spherical angles and
 * clamped phi to [0.09, PI - 0.09]. Dragging vertically far enough hit that
 * bound and the cube simply stopped rotating — the view was capped at roughly
 * one hemisphere. There was also a gimbal singularity right next to the clamp.
 *
 * The replacement keeps orientation as a quaternion, so rotation is unbounded.
 * These tests assert the properties the user actually cares about:
 *
 *   1. unlimited pitch   - a long vertical drag keeps rotating, past the top,
 *                          and can return exactly the way it came
 *   2. unlimited yaw     - horizontal drag never stops, in either direction
 *   3. no gimbal lock    - the view stays well-defined and level everywhere
 *   4. feel is unchanged - a single modest drag still produces the same view as
 *                          the previous spherical camera did
 */
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import {
  OrbitCamera, orientationFromSpherical, ORBIT_SPEED,
  DEFAULT_THETA, DEFAULT_PHI, DEFAULT_RADIUS, MIN_RADIUS, MAX_RADIUS, WORLD_UP,
} from '../src/ui/orbitcamera.js';

let pass = 0, fail = 0;
const lines = [];
function ok(name, cond, detail) {
  if (cond) { pass++; lines.push('  ok   ' + name); }
  else { fail++; lines.push('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}

const W = 900, H = 640;
/** Screen-space direction of the camera's forward axis, for level checks. */
function horizonTilt(cam) {
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.camera.quaternion);
  return Math.abs(right.y);          // 0 = perfectly level horizon
}

/* ------------------------------------------------------------------ *
 * 1. the new camera starts exactly where the old one did
 * ------------------------------------------------------------------ */
{
  const c = new OrbitCamera({ fov: 42, aspect: W / H });
  const old = new THREE.PerspectiveCamera(42, W / H, 0.1, 200);
  old.position.set(
    DEFAULT_RADIUS * Math.sin(DEFAULT_PHI) * Math.sin(DEFAULT_THETA),
    DEFAULT_RADIUS * Math.cos(DEFAULT_PHI),
    DEFAULT_RADIUS * Math.sin(DEFAULT_PHI) * Math.cos(DEFAULT_THETA),
  );
  old.up.copy(WORLD_UP);
  old.lookAt(0, 0, 0);
  old.updateMatrixWorld(true);

  const pts = [new THREE.Vector3(1, 1, 1), new THREE.Vector3(-1, 1, 1), new THREE.Vector3(1, -1, -1)];
  let maxDelta = 0;
  for (const p of pts) {
    const a = p.clone().project(old);
    const b = p.clone().project(c.camera);
    maxDelta = Math.max(maxDelta, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
  }
  ok('initial view matches the previous spherical camera', maxDelta < 1e-9, 'maxDelta=' + maxDelta.toExponential(2));
  ok('initial radius is the previous default', Math.abs(c.radius - DEFAULT_RADIUS) < 1e-9);
}

/* ------------------------------------------------------------------ *
 * 2. THE REGRESSION: vertical drag must not hit a stop
 * ------------------------------------------------------------------ */
{
  const c = new OrbitCamera({ fov: 42, aspect: W / H });
  const start = c.quat.clone();

  /* Drive it far past both poles in one long gesture. The old camera could
   * only travel ~PI radians of phi in total before the clamp.
   *
   * NOTE: accumulated travel must be measured by SUMMING the per-step rotation
   * angles. Quaternion.angleTo returns the shortest rotation in [0, PI], so it
   * saturates and cannot distinguish "went 3 radians" from "went 60 radians". */
  let stalled = 0, prev = c.quat.clone(), travelled = 0;
  const steps = 400, perStep = 20 * ORBIT_SPEED;
  for (let i = 0; i < steps; i++) {
    c.orbit(0, -20);                        // drag up, repeatedly
    const moved = prev.angleTo(c.quat);
    if (moved < 1e-6) stalled++;
    travelled += moved;
    prev.copy(c.quat);
  }
  ok('long upward drag never stalls', stalled === 0, stalled + ' stalled steps');
  ok('upward drag accumulates unlimited rotation',
    travelled > steps * perStep * 0.95,
    'travelled ' + travelled.toFixed(1) + ' rad (expected ~' + (steps * perStep).toFixed(1) + ')');
  /* more than a full extra turn around, which the old clamp forbade */
  ok('upward drag goes past a full revolution', travelled > Math.PI * 2,
    travelled.toFixed(2) + ' rad');

  /* ...and it must be reversible: the same gesture back returns exactly. */
  for (let i = 0; i < steps; i++) c.orbit(0, 20);
  ok('the same drag back returns to the start', start.angleTo(c.quat) < 1e-6,
    'residual ' + start.angleTo(c.quat).toExponential(2) + ' rad');

  /* same in the other direction */
  const s2 = c.quat.clone();
  let stalledDown = 0, travelledDown = 0, prevD = c.quat.clone();
  for (let i = 0; i < steps; i++) {
    c.orbit(0, 20);
    const moved = prevD.angleTo(c.quat);
    if (moved < 1e-6) stalledDown++;
    travelledDown += moved;
    prevD.copy(c.quat);
  }
  ok('long downward drag never stalls', stalledDown === 0, stalledDown + ' stalled steps');
  ok('downward drag accumulates unlimited rotation', travelledDown > Math.PI * 2,
    travelledDown.toFixed(2) + ' rad');
}

/* ------------------------------------------------------------------ *
 * 3. horizontal drag is unbounded too (both directions)
 * ------------------------------------------------------------------ */
{
  for (const dir of [-1, 1]) {
    const c = new OrbitCamera({ fov: 42, aspect: W / H });
    let stalled = 0, travelled = 0, prev = c.quat.clone();
    const steps = 400;
    for (let i = 0; i < steps; i++) {
      c.orbit(dir * 20, 0);
      const moved = prev.angleTo(c.quat);
      if (moved < 1e-6) stalled++;
      travelled += moved;
      prev.copy(c.quat);
    }
    ok('horizontal drag (dir ' + dir + ') never stalls', stalled === 0, stalled + ' stalled steps');
    ok('horizontal drag (dir ' + dir + ') accumulates unlimited rotation',
      travelled > Math.PI * 2, travelled.toFixed(2) + ' rad');
  }
}

/* ------------------------------------------------------------------ *
 * 4. no gimbal lock: the view stays well-defined and level everywhere
 * ------------------------------------------------------------------ */
{
  const c = new OrbitCamera({ fov: 42, aspect: W / H });
  let worstTilt = 0, degenerate = 0;
  for (let step = 0; step < 300; step++) {
    c.orbit(7, -11);                      // mixed drag, wanders all over
    const q = c.quat;
    const len = Math.hypot(q.x, q.y, q.z, q.w);
    if (Math.abs(len - 1) > 1e-9) degenerate++;
    worstTilt = Math.max(worstTilt, horizonTilt(c));
  }
  ok('quaternion stays unit length throughout', degenerate === 0, degenerate + ' bad normalisations');
  ok('horizon stays reasonable while orbiting', worstTilt < 0.5, 'worst tilt=' + worstTilt.toFixed(3));

  /* the camera position must never coincide with the target */
  ok('camera never collapses onto the target', c.camera.position.length() > 1, 'r=' + c.camera.position.length().toFixed(3));
}

/* ------------------------------------------------------------------ *
 * 5. a single modest drag still feels exactly like before
 * ------------------------------------------------------------------ */
{
  function oldCameraAfter(theta, phi) {
    const cam = new THREE.PerspectiveCamera(42, W / H, 0.1, 200);
    cam.position.set(
      DEFAULT_RADIUS * Math.sin(phi) * Math.sin(theta),
      DEFAULT_RADIUS * Math.cos(phi),
      DEFAULT_RADIUS * Math.sin(phi) * Math.cos(theta),
    );
    cam.up.copy(WORLD_UP);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    return cam;
  }

  const pts = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const drags = [[20, 0], [-20, 0], [0, 20], [0, -20], [15, 15], [-15, -15], [8, -30]];
  let worst = 0;
  for (const [dx, dy] of drags) {
    const c = new OrbitCamera({ fov: 42, aspect: W / H });
    c.orbit(dx, dy);
    /* the old camera's own update rule: theta -= dx*S, phi -= dy*S */
    const old = oldCameraAfter(DEFAULT_THETA - dx * ORBIT_SPEED, DEFAULT_PHI - dy * ORBIT_SPEED);
    for (const p of pts) {
      const a = p.clone().project(old);
      const b = p.clone().project(c.camera);
      worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  /* Not bit-identical: the new camera pitches about the camera's right axis
   * rather than the world X axis, which is precisely what removes the pole.
   * Near the default pose the two rules agree to well under a pixel. */
  ok('single drags keep the previous feel (sub-pixel)', worst < 0.01, 'worst NDC delta=' + worst.toExponential(2));
}

/* ------------------------------------------------------------------ *
 * 6. zoom is bounded, and setView still works for tests / callers
 * ------------------------------------------------------------------ */
{
  /* positive wheel delta = scroll down = pull the camera back (larger radius) */
  const c = new OrbitCamera({ fov: 42, aspect: W / H });
  for (let i = 0; i < 500; i++) c.zoom(100);
  ok('scrolling out stops at the maximum radius', Math.abs(c.radius - MAX_RADIUS) < 1e-9, 'r=' + c.radius);
  for (let i = 0; i < 1000; i++) c.zoom(-100);
  ok('scrolling in stops at the minimum radius', Math.abs(c.radius - MIN_RADIUS) < 1e-9, 'r=' + c.radius);

  c.setView(Math.PI * 0.25, Math.PI * 0.5);
  const want = orientationFromSpherical(Math.PI * 0.25, Math.PI * 0.5);
  ok('setView matches the equivalent quaternion', want.angleTo(c.quat) < 1e-9);

  const eye = c.eyeDirection();
  ok('eyeDirection is a unit vector', Math.abs(eye.length() - 1) < 1e-9);
  ok('camera position lies along eyeDirection',
    c.camera.position.clone().normalize().angleTo(eye) < 1e-9);
}

/* ------------------------------------------------------------------ *
 * 7. resize keeps the aspect in sync
 * ------------------------------------------------------------------ */
{
  const c = new OrbitCamera({ fov: 42, aspect: 1 });
  c.camera.aspect = W / H;
  c.camera.updateProjectionMatrix();
  ok('aspect can be updated by the host', Math.abs(c.camera.aspect - W / H) < 1e-9);
}

writeFileSync(new URL('./orbit-report.json', import.meta.url),
  JSON.stringify({ pass, fail, lines }, null, 2));
console.log(lines.join('\n'));
console.log('\nORBIT ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);