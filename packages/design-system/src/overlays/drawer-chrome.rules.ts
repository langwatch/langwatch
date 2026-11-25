/** The translucent header and footer ship off until Alex has seen light and dark screenshots. */
export const DRAWER_GLASS_DEFAULT = true;

/** A scrollport within one pixel of an end counts as at that end. */
const EDGE_TOLERANCE_PX = 1;

export interface DrawerEdges {
  /** Content has scrolled beneath the header. */
  top: boolean;
  /** More content waits beneath the footer. */
  bottom: boolean;
}

export const NO_DRAWER_EDGES: DrawerEdges = { top: false, bottom: false };

/** Which of the header and footer edges are on, from the scrollport's own geometry. */
export function drawerEdges({
  scrollTop,
  scrollHeight,
  clientHeight,
}: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): DrawerEdges {
  const range = scrollHeight - clientHeight;
  if (range <= EDGE_TOLERANCE_PX) return NO_DRAWER_EDGES;
  const position = Math.min(Math.max(scrollTop, 0), range);
  return {
    top: position > EDGE_TOLERANCE_PX,
    bottom: range - position > EDGE_TOLERANCE_PX,
  };
}

export function sameDrawerEdges(a: DrawerEdges, b: DrawerEdges): boolean {
  return a.top === b.top && a.bottom === b.bottom;
}
