/**
 * The geometry behind the home page's send: where the travelling composer
 * starts, where it has to land, and the warm mass that rides behind it.
 *
 * Kept out of the hook and out of React so the arithmetic can be tested
 * without a panel, a page or a browser.
 *
 * Spec: specs/home/langy-home-morph.feature
 */

/** A viewport-space box. `position: fixed` coordinates, so no scroll offsets. */
export interface MorphRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Marks the panel's own outermost animated box, the one framer transforms. */
export const PANEL_ROOT_ATTR = "data-langy-panel-root";

/** How far the warm copy of the block's light overhangs the composer. */
const GLOW_BLEED = 64;

export function readRect(element: Element): MorphRect {
  const { top, left, width, height } = element.getBoundingClientRect();
  return { top, left, width, height };
}

/**
 * The radial copy of the block's warm mass, sized around the bar it rides
 * behind. It is a COPY: the block's own canvas never moves, so the light that
 * travels has to be a cheap stand-in that dies on arrival.
 */
export function glowRectFor(origin: MorphRect): MorphRect {
  return {
    top: origin.top - GLOW_BLEED,
    left: origin.left - GLOW_BLEED,
    width: origin.width + GLOW_BLEED * 2,
    height: origin.height + GLOW_BLEED * 2,
  };
}

/** The halfway pose, for previewing the travel without waiting for it. */
export function midpointRect(origin: MorphRect, destination: MorphRect): MorphRect {
  return {
    top: origin.top + (destination.top - origin.top) / 2,
    left: origin.left + (destination.left - origin.left) / 2,
    width: origin.width + (destination.width - origin.width) / 2,
    height: origin.height + (destination.height - origin.height) / 2,
  };
}

/**
 * Read an element's rect as if the panel around it were at rest.
 *
 * The panel stays MOUNTED when closed — closing is a transform, not an
 * unmount — so its layout box is already the open one and only the transform
 * is in the way. Measuring straight through that transform is the documented
 * hazard: the docked panel is pushed a full panel-width to the right, and the
 * floating one carries a scale as well, so a rect read while closed describes
 * somewhere the composer will never be.
 *
 * So neutralise the transform for exactly one read and put it back. Framer
 * owns that inline style and rewrites it on its next frame, so the restore is
 * belt and braces rather than the thing that keeps it correct: what matters is
 * that nothing paints in between, and nothing can, because this is synchronous.
 */
export function readRectAtRest(element: HTMLElement): MorphRect {
  const panelRoot = element.closest<HTMLElement>(`[${PANEL_ROOT_ATTR}]`);
  if (!panelRoot) return readRect(element);

  const previousTransform = panelRoot.style.transform;
  const previousTransition = panelRoot.style.transition;
  panelRoot.style.transform = "none";
  panelRoot.style.transition = "none";
  const rect = readRect(element);
  panelRoot.style.transform = previousTransform;
  panelRoot.style.transition = previousTransition;
  return rect;
}
