/** Shared face metadata for the UI (no three.js dependency). */

export const FACE_NORMAL = [
  [0, 1, 0],   // U
  [1, 0, 0],   // R
  [0, 0, 1],   // F
  [0, -1, 0],  // D
  [-1, 0, 0],  // L
  [0, 0, -1],  // B
];

export const FACE_COLORS_HEX = [
  0xf7f7f7, // U white
  0xd8352a, // R red
  0x27a54a, // F green
  0xf7d000, // D yellow
  0xf07f1a, // L orange
  0x1f6fd0, // B blue
];

export const FACE_NAMES = ['U', 'R', 'F', 'D', 'L', 'B'];

/** face index -> rotation axis (0=x, 1=y, 2=z) */
export const FACE_AXIS = [1, 0, 2, 1, 0, 2];

/** face index -> coordinate of the layer it turns (+1 or -1) */
export const FACE_LAYER = [1, 1, 1, -1, -1, -1];

/** face index -> signed quarter-turn angle about the positive axis */
export const FACE_ANGLE = [
  -Math.PI / 2, // U
  -Math.PI / 2, // R
  -Math.PI / 2, // F
  Math.PI / 2,  // D
  Math.PI / 2,  // L
  Math.PI / 2,  // B
];
