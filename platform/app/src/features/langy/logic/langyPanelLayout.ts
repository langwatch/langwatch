/** Desktop ceiling for the floating companion. */
export const FLOATING_PANEL_MAX_WIDTH = 432;

/** Keep a useful reading measure on small laptop / split-window layouts. */
export const FLOATING_PANEL_MIN_WIDTH = 340;

/** Symmetric viewport breathing room when even the minimum cannot fit. */
export const FLOATING_PANEL_VIEWPORT_GUTTER = 24;

export const FLOATING_PANEL_VIEWPORT_SHARE = 0.74;

/**
 * CSS owns ordinary resizing; this equivalent numeric resolver is used only by
 * the drawer-crossing animation, which needs the card's real width in pixels.
 */
export function resolveFloatingPanelWidth(viewportWidth: number): number {
  if (viewportWidth <= 0) return FLOATING_PANEL_MAX_WIDTH;

  return Math.min(
    FLOATING_PANEL_MAX_WIDTH,
    Math.max(
      FLOATING_PANEL_MIN_WIDTH,
      viewportWidth * FLOATING_PANEL_VIEWPORT_SHARE,
    ),
    Math.max(0, viewportWidth - FLOATING_PANEL_VIEWPORT_GUTTER),
  );
}

export const FLOATING_PANEL_CSS_WIDTH = `min(${FLOATING_PANEL_MAX_WIDTH}px, max(${FLOATING_PANEL_MIN_WIDTH}px, ${FLOATING_PANEL_VIEWPORT_SHARE * 100}vw), calc(100vw - ${FLOATING_PANEL_VIEWPORT_GUTTER}px))`;
