/**
 * Unlimited orbit camera.
 *
 * The previous camera stored its pose as spherical angles (theta, phi) and
 * clamped phi to [e, PI - e] so the view could never reach a pole. That clamp
 * is a hard stop in the UI: drag far enough vertically and the cube simply
 * stops rotating, because `phi` has hit its bound and further drags are
 * discarded. It also sits right next to a gimbal singularity.
 *
 * This camera keeps its orientation as a UNIT QUATERNION and applies each drag
 * as an incremental rotation:
 *
 *   horizontal drag -> rotate about the WORLD up axis
 *   vertical drag   -> rotate about the CAMERA's own right axis
 *
 * Because the orientation is never decomposed back into angles, there is no
 * angle to clamp and no pole to run into: rotation continues indefinitely in
 * every direction, and the horizon stays level for ordinary drags. Passing
 * "over the top" is smooth and reversible.
 *
 * The rotation rate and the resulting views are chosen to match the previous
 * spherical camera exactly for drags away from the poles, so the feel is
 * unchanged where the old behaviour was already good.
 *
 * Only three.js *math* is used here (no renderer, no DOM), so this module is
 * directly unit-testable in Node.
 */

import * as THREE from 'three';

export const WORLD_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_RIGHT = new THREE.Vector3(1, 0, 0);
const LOCAL_BACK = new THREE.Vector3(0, 0, 1);
const ORIGIN = new THREE.Vector3(0, 0, 0);

/** radians of rotation per pixel of drag */
export const ORBIT_SPEED = 0.0075;

/**
 * Sign of the HORIZONTAL (left/right) orbit.
 *
 *   +1 : drag right swings the CAMERA to the right, bringing the cube's right
 *        face into view — the view orbits in the direction of the drag.
 *   -1 : drag right swings the CUBE's front face to the right, i.e. the cube
 *        follows the finger (this is what three.js OrbitControls does, and
 *        what this camera used to do).
 *
 * The app uses +1. Flip this single constant to swap the horizontal feel.
 */
export const HORIZONTAL_SIGN = 1;
/** world units of radius change per wheel delta unit */
export const ZOOM_SPEED = 0.0022;

/** Default viewing direction, as the (theta, phi) the old camera started at. */
export const DEFAULT_THETA = Math.PI * 0.28;

export const DEFAULT_PHI = Math.PI * 0.32;
export const DEFAULT_RADIUS = 9.6;
export const MIN_RADIUS = 6.2;
export const MAX_RADIUS = 18;

/**
 * Orientation of a camera sitting at the spherical point (theta, phi) and
 * looking at the origin with a level horizon.
 */
export function orientationFromSpherical(theta, phi, out) {
  const eye = new THREE.Vector3(
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta),
  );
  const m = new THREE.Matrix4().lookAt(eye, ORIGIN, WORLD_UP);
  return (out || new THREE.Quaternion()).setFromRotationMatrix(m);
}

export class OrbitCamera {
  constructor(opts = {}) {
    const {
      fov = 42, aspect = 1, near = 0.1, far = 200,
      radius = DEFAULT_RADIUS,
      theta = DEFAULT_THETA,
      phi = DEFAULT_PHI,
      minRadius = MIN_RADIUS,
      maxRadius = MAX_RADIUS,
    } = opts;

    this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.quat = orientationFromSpherical(theta, phi);
    this.radius = radius;
    this.minRadius = minRadius;
    this.maxRadius = maxRadius;
    this._tmpRight = new THREE.Vector3();
    this.update();
  }

  /**
   * Orbit by a screen-space drag in pixels.
   *
   * Unbounded by construction: the yaw is a world rotation (so it can spin
   * forever) and the pitch is about the camera's current right axis (so it can
   * roll right over the top and keep going instead of stopping at a pole).
   */
  orbit(dx, dy) {
    /* Horizontal: yaw about the WORLD up axis, so the horizon never tilts and
     * the spin can continue forever. HORIZONTAL_SIGN picks which way the view
     * swings relative to the drag. */
    if (dx) {
      const yaw = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, HORIZONTAL_SIGN * dx * ORBIT_SPEED);
      this.quat.premultiply(yaw);
    }
    if (dy) {
      /* the camera's own right axis, in world space, for the current pose */
      this._tmpRight.copy(LOCAL_RIGHT).applyQuaternion(this.quat);
      const pitch = new THREE.Quaternion().setFromAxisAngle(this._tmpRight, -dy * ORBIT_SPEED);
      this.quat.premultiply(pitch);
    }
    if (dx || dy) {
      this.quat.normalize();
      this.update();
    }
  }

  /** Wheel zoom. Radius is clamped (a sensible bound, unlike the orbit angle). */
  zoom(delta) {
    const r = this.radius + delta * ZOOM_SPEED;
    this.radius = Math.max(this.minRadius, Math.min(this.maxRadius, r));
    this.update();
  }

  /**
   * Jump to a spherical pose. Kept for callers/tests that think in angles;
   * orbiting itself never goes through here.
   */
  setView(theta, phi) {
    orientationFromSpherical(theta, phi, this.quat);
    this.update();
  }

  /** Push the current pose onto the three.js camera. */
  update() {
    this.camera.quaternion.copy(this.quat);
    this.camera.position.copy(LOCAL_BACK).applyQuaternion(this.quat).multiplyScalar(this.radius);
    this.camera.updateMatrixWorld(true);
  }

  /** Unit vector from the target toward the camera. */
  eyeDirection(out) {
    return (out || new THREE.Vector3()).copy(LOCAL_BACK).applyQuaternion(this.quat);
  }

  /** Current polar angle, for diagnostics and tests (never used to orbit). */
  get phi() {
    return Math.acos(Math.max(-1, Math.min(1, this.eyeDirection().y)));
  }
}
