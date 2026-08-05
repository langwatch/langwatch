import {
  FLOATING_PANEL_INSET,
  resolveFloatingPanelWidth,
} from "./langyPanelLayout";

/**
 * The minimised peek — the PANEL ITSELF, slid down (or right) until only a
 * sliver of its own header shows.
 *
 * There is no separate peek element, and there was never a good reason for
 * one: the panel already stays mounted while closed (unmounting would tear
 * down an in-flight stream), so minimising is a change of TRANSFORM on the one
 * node, not a swap between two. A swap is exactly what read as "popping in and
 * out" — two elements trading places can never look like one object moving.
 * What you see peeking is literally the top of the panel: its own header, its
 * own surface, its own hairline and rounded corners.
 *
 * Three positions on one continuous axis:
 *
 *   rest   — the panel is down, leaving a thin sliver of its header lip.
 *            Deliberately subtler than a title bar: present enough to find,
 *            quiet enough to forget.
 *   near   — the pointer is approaching (or the peek holds keyboard focus):
 *            the SAME element rises a little further, enough to read the
 *            header line. An invitation, not an opening.
 *   open   — the translate resolves to nothing and the panel is simply itself.
 *
 * Driven through the CSS `translate` property rather than `transform`, for one
 * specific reason: `transform` on this node is already owned by framer (the
 * layout morph between dock and floating card, plus the open/close variant).
 * `translate` is a separate, independently-animatable property that composes
 * with it instead of fighting it — and, unlike framer's numeric values, it
 * takes `calc(100% - Npx)` natively, so the sliver is exact without anyone
 * having to measure the panel's height.
 *
 * Spec: specs/langy/langy-peek-dock.feature
 */

export type LangyPeekPhase = "rest" | "near";

// ── How much of the panel stays visible, per mode and phase ────────────────
/**
 * Floating: px of the panel's own header visible above the bottom viewport
 * edge. The card is bottom-anchored on `FLOATING_PANEL_INSET`, so that inset
 * is already visible and is subtracted out in `resolvePeekTranslate` — the
 * number here is the sliver you actually see.
 */
export const FLOATING_PEEK_REST_PX = 30;
/** Risen far enough that the header's line — mark, title — reads. */
export const FLOATING_PEEK_NEAR_PX = 52;

/**
 * Sidebar: px of the dock's spine visible at the right edge. Thinner than the
 * floating lip because it runs the ENTIRE height of the viewport — the same
 * few pixels are a far larger and far easier target here.
 */
export const SIDEBAR_PEEK_REST_PX = 12;
/** Risen far enough to show the header's leading edge. */
export const SIDEBAR_PEEK_NEAR_PX = 32;

/** How much of the panel shows for a given mode + phase. */
export function resolvePeekVisiblePx({
  mode,
  phase,
}: {
  mode: "floating" | "sidebar";
  phase: LangyPeekPhase;
}): number {
  if (mode === "floating") {
    return phase === "near" ? FLOATING_PEEK_NEAR_PX : FLOATING_PEEK_REST_PX;
  }
  return phase === "near" ? SIDEBAR_PEEK_NEAR_PX : SIDEBAR_PEEK_REST_PX;
}

/**
 * The CSS `translate` value that puts the panel at a peek position.
 *
 * Floating slides down its own full height (`100%`) less the part that should
 * stay showing. Sidebar is the same idea on X, against the dock's own width.
 */
export function resolvePeekTranslate({
  mode,
  phase,
}: {
  mode: "floating" | "sidebar";
  phase: LangyPeekPhase;
}): string {
  const visible = resolvePeekVisiblePx({ mode, phase });
  if (mode === "floating") {
    // Whatever the bottom inset already shows is not travel we need to undo.
    const travel = Math.max(0, visible - FLOATING_PANEL_INSET);
    return `0 calc(100% - ${travel}px)`;
  }
  return `calc(100% - ${visible}px) 0`;
}

// ── Proximity ───────────────────────────────────────────────────────────────
/**
 * The pop arms when the pointer comes within ENTER px of the resting sliver,
 * and disarms only past EXIT px — hysteresis, so a pointer hovering right on
 * the boundary can't strobe the panel up and down.
 */
export const PEEK_PROXIMITY_ENTER_PX = 140;
export const PEEK_PROXIMITY_EXIT_PX = 200;

interface PeekProximityInput {
  pointerX: number;
  pointerY: number;
  viewportWidth: number;
  viewportHeight: number;
  mode: "floating" | "sidebar";
  /** Floating only: a right-anchored drawer holds the corner, panel went left. */
  dodgeLeft: boolean;
  /** The previous verdict — what the hysteresis pivots on. */
  wasNear: boolean;
}

/**
 * Is the pointer near the peeking panel? Pure — the hook feeds it pointer +
 * viewport and the previous verdict. Distance is measured to the RESTING
 * sliver's rectangle (the thing the user is aiming at), not the risen one, so
 * the zone doesn't grow the moment the panel rises.
 */
export function resolvePeekProximity({
  pointerX,
  pointerY,
  viewportWidth,
  viewportHeight,
  mode,
  dodgeLeft,
  wasNear,
}: PeekProximityInput): boolean {
  const rect = restingPeekRect({
    viewportWidth,
    viewportHeight,
    mode,
    dodgeLeft,
  });
  const dx = Math.max(rect.left - pointerX, 0, pointerX - rect.right);
  const dy = Math.max(rect.top - pointerY, 0, pointerY - rect.bottom);
  const distance = Math.hypot(dx, dy);
  const threshold = wasNear ? PEEK_PROXIMITY_EXIT_PX : PEEK_PROXIMITY_ENTER_PX;
  return distance <= threshold;
}

/** The resting sliver's viewport rectangle — the proximity zone's anchor. */
function restingPeekRect({
  viewportWidth,
  viewportHeight,
  mode,
  dodgeLeft,
}: {
  viewportWidth: number;
  viewportHeight: number;
  mode: "floating" | "sidebar";
  dodgeLeft: boolean;
}): { left: number; right: number; top: number; bottom: number } {
  if (mode === "floating") {
    const width = resolveFloatingPanelWidth(viewportWidth);
    const left = dodgeLeft
      ? FLOATING_PANEL_INSET
      : viewportWidth - FLOATING_PANEL_INSET - width;
    return {
      left,
      right: left + width,
      top: viewportHeight - FLOATING_PEEK_REST_PX,
      bottom: viewportHeight,
    };
  }
  // The dock runs the full height, so its whole right edge is the target.
  return {
    left: viewportWidth - SIDEBAR_PEEK_REST_PX,
    right: viewportWidth,
    top: 0,
    bottom: viewportHeight,
  };
}
