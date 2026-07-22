import {
  FLOATING_PANEL_INSET,
  resolveFloatingPanelWidth,
} from "./langyPanelLayout";

/**
 * The minimised peek's geometry and proximity maths — all of it pure, all of
 * it here, so the component only ever renders what these functions resolve.
 *
 * Minimising Langy used to swap the panel for a corner orb. Now the panel
 * sinks to a PEEK of itself: floating mode leaves a sliver of the card's
 * header lip above the bottom viewport edge; sidebar mode leaves a thin
 * vertical sliver of the dock's spine on the right edge. Three states:
 *
 *   rest   — the sliver. Deliberately subtler than a title bar: present
 *            enough to find, quiet enough to forget.
 *   near   — the pointer is approaching the peek's edge region (or the peek
 *            holds keyboard focus): it rises a little further. An invitation,
 *            not an opening.
 *   open   — the panel is open; the peek stands down entirely (the component
 *            renders nothing — LangyPanel owns the open surface).
 *
 * Spec: specs/langy/langy-peek-dock.feature
 */

export type LangyPeekPhase = "rest" | "near";

// ── Floating mode: the card sinks below the bottom edge ────────────────────
/**
 * The sunk card's total height. Tall enough that its side hairlines visibly
 * run OFF the bottom of the viewport — which is what sells "the card sank"
 * rather than "a chip appeared" — and no taller, because everything below
 * the sliver is paint nobody sees.
 */
export const FLOATING_PEEK_CARD_HEIGHT = 76;
/** Sliver above the bottom edge at rest — the card's rounded top lip. */
export const FLOATING_PEEK_REST_PX = 10;
/** Risen height on proximity/focus — the full header line reads. */
export const FLOATING_PEEK_NEAR_PX = 36;

// ── Sidebar mode: the dock's spine peeks from the right edge ───────────────
/** The sliver card's full width (mostly offscreen right). */
export const SIDEBAR_PEEK_CARD_WIDTH = 44;
/** Visible spine at rest — a rim, not a control. */
export const SIDEBAR_PEEK_REST_PX = 6;
/** Risen width on proximity/focus — enough to show the mark. */
export const SIDEBAR_PEEK_NEAR_PX = 20;
/** The sliver's height, centred on the viewport's vertical middle. */
export const SIDEBAR_PEEK_HEIGHT = 128;

/**
 * How many px of the peek are visible above/inside the viewport edge for a
 * phase. One lookup, so the transform and the proximity hit zone can never
 * disagree about where the peek is.
 */
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
 * The CSS transform for a phase. The peek is laid out fully visible at the
 * viewport edge and TRANSLATED off it — transforms animate on the compositor,
 * and the same element slides between all three positions (entrance, rest,
 * near) on one property. Sidebar carries its own -50% Y centring so the
 * caller never has to compose transforms.
 */
export function resolvePeekTransform({
  mode,
  phase,
}: {
  mode: "floating" | "sidebar";
  phase: LangyPeekPhase;
}): string {
  const visible = resolvePeekVisiblePx({ mode, phase });
  if (mode === "floating") {
    return `translateY(${FLOATING_PEEK_CARD_HEIGHT - visible}px)`;
  }
  return `translate(${SIDEBAR_PEEK_CARD_WIDTH - visible}px, -50%)`;
}

/** Where the peek starts from (fully sunk) so its entrance can slide to rest. */
export function resolvePeekHiddenTransform(mode: "floating" | "sidebar"): string {
  if (mode === "floating") {
    return `translateY(${FLOATING_PEEK_CARD_HEIGHT}px)`;
  }
  return `translate(${SIDEBAR_PEEK_CARD_WIDTH}px, -50%)`;
}

// ── Proximity ───────────────────────────────────────────────────────────────
/**
 * The pop arms when the pointer comes within ENTER px of the resting sliver,
 * and disarms only past EXIT px — hysteresis, so a pointer hovering right on
 * the boundary can't strobe the peek up and down.
 */
export const PEEK_PROXIMITY_ENTER_PX = 140;
export const PEEK_PROXIMITY_EXIT_PX = 200;

interface PeekProximityInput {
  pointerX: number;
  pointerY: number;
  viewportWidth: number;
  viewportHeight: number;
  mode: "floating" | "sidebar";
  /** Floating only: a right-anchored drawer holds the corner, peek went left. */
  dodgeLeft: boolean;
  /** The previous verdict — what the hysteresis pivots on. */
  wasNear: boolean;
}

/**
 * Is the pointer near the peek? Pure — the hook feeds it pointer + viewport
 * and the previous verdict; distance is measured to the RESTING sliver's
 * rectangle (the thing the user is aiming at), not to the risen one, so the
 * zone doesn't grow the moment the peek rises.
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
  return {
    left: viewportWidth - SIDEBAR_PEEK_REST_PX,
    right: viewportWidth,
    top: viewportHeight / 2 - SIDEBAR_PEEK_HEIGHT / 2,
    bottom: viewportHeight / 2 + SIDEBAR_PEEK_HEIGHT / 2,
  };
}
