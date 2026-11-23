/** The space the drawer leaves between its edges and the viewport, matching its chrome margin. */
export const DRAWER_EDGE_MARGIN_PX = 8;

/** The strip of page left between the drawer and a control it must not cover. */
export const DRAWER_KEEP_CLEAR_GAP_PX = 12;

/**
 * The width the drawer renders at: the reader's preferred width, narrowed so the drawer
 * neither covers the page control it keeps clear (Ask Langy) nor runs under what holds
 * its right edge (the docked Langy panel). Spec: specs/traces-v2/trace-drawer-shell.feature.
 */
export function fitDrawerWidth({
  preferredPx,
  viewportWidth,
  rightReservePx,
  keepClearRightPx,
  minPx,
}: {
  preferredPx: number;
  viewportWidth: number;
  /** Distance from the viewport's right edge to the drawer's right edge. */
  rightReservePx: number;
  /** Right edge of the control the drawer must leave visible; `null` when none is on the page. */
  keepClearRightPx: number | null;
  minPx: number;
}): number {
  const leftEdge =
    keepClearRightPx === null ? DRAWER_EDGE_MARGIN_PX : keepClearRightPx + DRAWER_KEEP_CLEAR_GAP_PX;
  const available = Math.max(0, viewportWidth - rightReservePx - leftEdge);
  // Too little room for the minimum: keeping the control clear wins over the minimum width.
  if (available < minPx) return available;
  return Math.max(minPx, Math.min(preferredPx, available));
}

/** Marks the page control a wide drawer must leave visible. */
export const DRAWER_KEEP_CLEAR_ATTRIBUTE = "data-drawer-keep-clear";
