/**
 * Pointer interaction for the cube.
 *
 * Left-drag starting on a sticker turns that face's layer; left-drag starting
 * on empty background orbits the camera; the wheel zooms.
 *
 * Drag -> turn rule (resolveDrag):
 *   Grabbing a sticker on face F rolls the layer F belongs to, exactly as a
 *   finger would on a physical cube. The rotation axis is F's own axis; the
 *   sign is chosen so the grabbed point travels the same way as the pointer.
 *   For each candidate quarter turn we physically rotate the grabbed point,
 *   project the resulting displacement into screen space, and keep the
 *   candidate with the best positive dot product against the drag.
 *
 *   If the grab lands exactly on the rotation axis (the centre sticker), the
 *   point itself does not move, so we fall back to rotating the face's tangent
 *   basis (k x u) and compare that against the drag instead.
 */

import * as THREE from 'three';
import { FACE_AXIS, FACE_LAYER } from './facemeta.js';
import { rotVec, turnQuarter } from './cube3d.js';

/** unit vector for world axis 0/1/2 */
function axisUnit(k) {
  return new THREE.Vector3(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
}

/** face whose outward normal is +axis (positive=true) or -axis. */
export function faceOfAxis(axis, positive) {
  if (axis === 0) return positive ? 1 : 4;  // R / L
  if (axis === 1) return positive ? 0 : 3;  // U / D
  return positive ? 2 : 5;                  // F / B
}

/** amount (1 or 3) whose quarter count about +axis equals `sign`. */
export function amountForSign(face, sign) {
  return turnQuarter(face, 1) === sign ? 1 : 3;
}

/**
 * Resolve a drag on `grabFace` into a face turn, or null when the drag is too
 * small or has no usable screen direction.
 *
 * @param grabFace   face the drag started on
 * @param grabLocal  grabbed surface point, cube-local coordinates
 * @param grabCubie  grabbed cubie's logical position [x,y,z] (diagnostics only)
 * @param dragScreen screen-space drag vector {x,y}
 * @param project    (worldVec) -> {x,y} screen displacement, in pixels
 */
export function resolveDrag(grabFace, grabLocal, grabCubie, dragScreen, project) {
  const drag = new THREE.Vector2(dragScreen.x, dragScreen.y);
  if (drag.length() < 4) return null;
  const dragN = drag.clone().normalize();

  const k = FACE_AXIS[grabFace];
  const face = faceOfAxis(k, FACE_LAYER[grabFace] > 0);

  /* best alignment found among the two turn directions */
  let bestSign = 0, bestDot = 0;

  /* ---- normal case: the grabbed point itself moves ---- */
  for (const sign of [1, -1]) {
    const disp = rotVec(grabLocal, k, sign).sub(grabLocal);
    if (disp.lengthSq() < 1e-12) continue;      // grab is on the rotation axis
    const ds = project(disp);
    const dv = new THREE.Vector2(ds.x, ds.y);
    if (dv.length() < 1e-6) continue;           // motion points along the view axis
    const dot = dv.clone().normalize().dot(dragN);
    if (dot > bestDot) { bestDot = dot; bestSign = sign; }
  }

  /* ---- centre-sticker case: rotate the face's tangent basis instead ---- */
  if (bestSign === 0) {
    const n = axisUnit(k);
    for (const sign of [1, -1]) {
      const axis = sign > 0 ? n : n.clone().negate();
      let score = -Infinity;
      for (let a = 0; a < 3; a++) {
        if (a === k) continue;
        const u = axisUnit(a);
        const moved = new THREE.Vector3().crossVectors(axis, u);
        const ds = project(moved);
        const dv = new THREE.Vector2(ds.x, ds.y);
        if (dv.length() < 1e-6) continue;
        const dot = dv.clone().normalize().dot(dragN);
        if (dot > score) score = dot;
      }
      if (score > bestDot) { bestDot = score; bestSign = sign; }
    }
  }

  if (bestSign === 0 || bestDot <= 0) return null;
  return { face, amount: amountForSign(face, bestSign) };
}

export class PointerController {
  constructor(view, host, hooks) {
    this.view = view;
    this.host = host;
    this.hooks = hooks || {};
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.mode = null;
    this.grab = null;
    this.last = { x: 0, y: 0 };
    this.moved = 0;

    this._down = (e) => this.onDown(e);
    this._move = (e) => this.onMove(e);
    this._up = (e) => this.onUp(e);
    this._wheel = (e) => this.onWheel(e);
    this._ctx = (e) => e.preventDefault();

    host.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    host.addEventListener('wheel', this._wheel, { passive: false });
    host.addEventListener('contextmenu', this._ctx);
  }

  ndcFromEvent(e) {
    const r = this.host.getBoundingClientRect();
    this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    return this.ndc;
  }

  /** {cubie, face, point} under the pointer, or null. */
  pick(e) {
    this.ndcFromEvent(e);
    this.raycaster.setFromCamera(this.ndc, this.view.camera);
    this.view.root.updateMatrixWorld(true);
    const hits = this.raycaster.intersectObjects(this.view.cubies, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.stickers) o = o.parent;
      if (!o) continue;
      const face = faceOfHit(h, o);
      if (face >= 0) return { cubie: o, face, point: h.point };
    }
    return null;
  }

  /** Project a world direction at the grab point into screen pixels. */
  makeProjector(grabPoint) {
    const cam = this.view.camera;
    const r = this.host.getBoundingClientRect();
    const p0 = grabPoint.clone().project(cam);
    return (worldVec) => {
      const p1 = grabPoint.clone().add(worldVec.clone().multiplyScalar(0.5)).project(cam);
      return { x: (p1.x - p0.x) * 0.5 * r.width, y: -(p1.y - p0.y) * 0.5 * r.height };
    };
  }

  onDown(e) {
    if (e.button !== 0) return;
    this.moved = 0;
    this.last = { x: e.clientX, y: e.clientY };
    if (this.view.busy) return;
    const hit = this.pick(e);
    if (hit) { this.mode = 'turn'; this.grab = hit; }
    else { this.mode = 'orbit'; }
    this.host.classList.add('dragging');
  }

  onMove(e) {
    if (!this.mode) return;
    const dx = e.clientX - this.last.x;
    const dy = e.clientY - this.last.y;
    this.moved += Math.abs(dx) + Math.abs(dy);

    if (this.mode === 'orbit') {
      this.view.orbit(dx, dy);
      this.last = { x: e.clientX, y: e.clientY };
      return;
    }

    if (this.mode === 'turn' && this.moved > 14) {
      const mv = this.dragToMove(e);
      this.mode = null;
      this.host.classList.remove('dragging');
      if (mv && this.hooks.onTurn) this.hooks.onTurn(mv);
    }
  }

  onUp() {
    this.mode = null;
    this.grab = null;
    this.host.classList.remove('dragging');
  }

  onWheel(e) {
    e.preventDefault();
    this.view.zoom(e.deltaY);
  }

  dragToMove(e) {
    const g = this.grab;
    if (!g) return null;
    const local = this.view.root.worldToLocal(g.point.clone());
    const cu = g.cubie.userData;
    const pos = cu.pos || [cu.x, cu.y, cu.z];
    const dragScreen = { x: e.clientX - this.last.x, y: e.clientY - this.last.y };
    return resolveDrag(g.face, local, pos, dragScreen, this.makeProjector(g.point));
  }

  dispose() {
    this.host.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    this.host.removeEventListener('wheel', this._wheel);
    this.host.removeEventListener('contextmenu', this._ctx);
  }
}

/**
 * Which WORLD face of the cube the hit belongs to.
 *
 * Determined from the world-space offset between the hit point and the cubie's
 * centre. The cubie's own local frame is NOT usable here: a cubie that has been
 * turned carries that rotation, so its local +x can point at world -x. The cube
 * itself stays axis aligned in world space, so the dominant world component of
 * the offset identifies the face the user actually clicked.
 */
export function faceOfHit(hit, cubie) {
  const centre = new THREE.Vector3();
  cubie.getWorldPosition(centre);
  const d = hit.point.clone().sub(centre);
  const ax = [Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)];
  const m = Math.max(ax[0], ax[1], ax[2]);
  if (m < 1e-6) return -1;                        // degenerate
  if (m === ax[0]) return d.x > 0 ? 1 : 4;        // R / L
  if (m === ax[1]) return d.y > 0 ? 0 : 3;        // U / D
  return d.z > 0 ? 2 : 5;                          // F / B
}
