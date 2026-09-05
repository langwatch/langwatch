import { FLOATING_PANEL_INSET, resolveFloatingPanelWidth } from "./langy-panel-layout";

/**
 * Keeps the mounted panel itself visible as a small rest or near sliver. Unmounting
 * would lose an in-flight stream, while a separate peek element would make the
 * transition a swap rather than one continuous movement.
 */

export type LangyPeekPhase = "rest" | "near";

/**
 * Floating: px of the panel's own header visible above the bottom viewport edge.
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
 * Is the pointer near the peeking panel? Pure — the hook feeds it pointer + viewport
 * and the previous verdict.
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
    const left = dodgeLeft ? FLOATING_PANEL_INSET : viewportWidth - FLOATING_PANEL_INSET - width;
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
