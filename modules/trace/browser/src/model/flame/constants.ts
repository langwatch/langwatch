export const ROW_HEIGHT = 22;
export const ROW_GAP = 2;
export const MIN_BLOCK_PX = 2;
/**
 * Below this viewport-width %, a block is "tiny": too narrow to label, so it
 * renders calmer (softer fill, no border, 1px right gap, pill ends) so dense
 * strips read as discrete events instead of a broken bar.
 */
export const TINY_BLOCK_PCT = 0.8;
/** Soften factor applied to a tiny block's fill alpha. */
export const TINY_BLOCK_ALPHA_FACTOR = 0.6;
/** Above this span count, the context strip surfaces the drag-to-zoom hint. */
export const DENSE_SPAN_THRESHOLD = 40;
export const DEPTH_FADE_STEP = 0.04;
export const DEPTH_FADE_FLOOR = 0.7;
export const MINIMAP_WIDTH = 280;
export const MINIMAP_HEIGHT = 72;
export const MINIMAP_HANDLE_PX = 10;
export const ZOOM_ANIMATION_MS = 220;
export const DRAG_THRESHOLD_PX = 4;
export const MIN_VIEWPORT_MS = 0.05;
export const ZOOM_FIT_PADDING = 0.04;
export const WHEEL_ZOOM_SENSITIVITY = 0.0015;
