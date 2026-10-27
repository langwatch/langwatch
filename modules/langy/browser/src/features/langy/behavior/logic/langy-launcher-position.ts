/** The launcher's own width and its gap from whatever it sits beside, in px. */
export const LANGY_LAUNCHER_SIZE_PX = 46;
export const LANGY_LAUNCHER_GAP_PX = 20;

/**
 * How far the launcher sits from the viewport's right edge. Beside an open drawer it
 * moves just left of it; where that would put it on the sidebar or off the page, it
 * stays in the corner.
 */
export function langyLauncherRightOffset({
  drawerEdge,
  sidebarRight,
  viewportWidth,
}: {
  /** The open drawer's left edge, measured from the viewport's right edge. */
  drawerEdge: number | null;
  /** The sidebar's right edge, measured from the viewport's left edge; 0 with none. */
  sidebarRight: number;
  viewportWidth: number;
}): number {
  if (drawerEdge === null) return LANGY_LAUNCHER_GAP_PX;
  const besideDrawer = drawerEdge + LANGY_LAUNCHER_GAP_PX;
  const launcherLeft = viewportWidth - besideDrawer - LANGY_LAUNCHER_SIZE_PX;
  return launcherLeft >= sidebarRight + LANGY_LAUNCHER_GAP_PX
    ? besideDrawer
    : LANGY_LAUNCHER_GAP_PX;
}
