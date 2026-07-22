/**
 * The docked sidebar's width.
 *
 * A lean default: slim enough to read as a quiet companion rather than a
 * second pane, still wide enough that a trace table, a diff or a capability
 * card can breathe (380px forces everything into a column of two-word lines,
 * so we stay clear of that floor). The dock runs narrower than the floating
 * card: floating OVERLAYS the page, so its width is free; the dock takes its
 * width FROM the page for as long as it is open.
 * Spec: specs/langy/langy-panel-layout.feature
 */
export const SIDEBAR_PANEL_WIDTH = 392;

/** What the page reserves for the flush full-height dock (no-shell pages). */
export const LANGY_DOCKED_OFFSET = SIDEBAR_PANEL_WIDTH;

/**
 * The strip of page ground between the content card and the docked panel when
 * an app shell claims the dock, the gray breathing room that makes the panel
 * read as a second card rather than a pane glued to the first.
 */
export const LANGY_DOCK_GAP = 12;

/**
 * The app shell's header-bar height. The shell's content cards, and the
 * docked panel, which joins them as a second card, start below this line.
 * DashboardLayout derives its own viewport math from the same constant, so
 * the two cannot drift apart.
 */
export const APP_HEADER_HEIGHT = 56;

export const LANGY_TRANSITION = "240ms cubic-bezier(0.32, 0.72, 0, 1)";

/**
 * The spring a Langy surface moves on when it is being PLACED somewhere new,
 * as opposed to opening or closing.
 *
 * Deliberately slower than open/close. Switching between the dock and the
 * floating companion changes both the page's reserved gutter and the panel's
 * geometry; treating that as one spring makes it feel picked up and placed,
 * rather than a sidebar disappearing while a card pops in elsewhere.
 *
 * Lives here, not in LangyPanel, because it is no longer only the panel's:
 * the home page's composer travels to the panel's floor on this same spring,
 * so the two morphs read as one family. One definition, or they drift.
 */
export const PANEL_LAYOUT_TRANSITION = {
  type: "spring",
  stiffness: 330,
  damping: 34,
  mass: 0.82,
} as const;

/**
 * The floating card's symmetric viewport inset (a rounded card with a small,
 * SYMMETRIC inset on every side). One definition, shared by everything that
 * hangs off the card's edge: the inspector drawer (so the two can't drift a
 * pixel apart) and the minimised peek (which rests on the same horizontal
 * position, so sinking and rising never side-step).
 */
export const FLOATING_PANEL_INSET = 12;

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

/** The inspector drawer's visible width. */
export const INSPECTOR_WIDTH = 380;

/**
 * How far the inspector slides UNDER the panel's left edge.
 *
 * Butted up exactly against the panel, the drawer's own rounded right corners
 * stayed visible as two little notches against the panel's straight edge — the
 * pair read as two cards that happened to be touching. Tucking it a few pixels
 * behind (the panel sits at a higher z-index and paints over it) buries the
 * seam, so the drawer reads as something the panel pulled out of itself.
 */
export const INSPECTOR_TUCK = 10;

/**
 * The inspector's placement box, per panel layout.
 *
 * ONE derivation for both modes, so the drawer always mirrors the panel it
 * hangs off: same top and bottom edges (floating: the measured panel height,
 * bottom-anchored on the same inset; docked: the same header-to-floor span the
 * dock claims), and the seam edge landing exactly under the panel's left edge.
 */
export interface LangyInspectorFrame {
  /** Offset from the viewport's right edge to the drawer's right edge. */
  right: string;
  /** Null when the frame is bottom-anchored with an explicit height. */
  top: string | null;
  bottom: string;
  /** Null when top+bottom pin the height (the docked, full-height case). */
  height: string | null;
  /** A viewport safety cap for the explicit-height case; null otherwise. */
  maxHeight: string | null;
  /** The drawer's outward (left) corners; the tucked right edge stays square. */
  borderTopLeftRadius: string;
  borderBottomLeftRadius: string;
}

export function resolveInspectorFrame({
  floating,
  dockShellClaimed,
  panelHeightPx,
}: {
  floating: boolean;
  /** An app shell holds the dock below its header (sidebar mode only). */
  dockShellClaimed: boolean;
  /**
   * The panel's real rendered height (floating mode), measured by the panel
   * itself. Null before the first measurement — the frame falls back to the
   * panel's own resting silhouette so nothing jumps when the number lands.
   */
  panelHeightPx: number | null;
}): LangyInspectorFrame {
  if (floating) {
    return {
      right: `calc(${FLOATING_PANEL_CSS_WIDTH} + ${FLOATING_PANEL_INSET * 2 - INSPECTOR_TUCK}px)`,
      top: null,
      bottom: `${FLOATING_PANEL_INSET}px`,
      height:
        panelHeightPx !== null
          ? `${Math.round(panelHeightPx)}px`
          : `min(560px, calc(80dvh - ${FLOATING_PANEL_INSET}px))`,
      maxHeight: `calc(100dvh - ${FLOATING_PANEL_INSET * 2}px)`,
      borderTopLeftRadius: "20px",
      borderBottomLeftRadius: "20px",
    };
  }
  return {
    right: `${SIDEBAR_PANEL_WIDTH - INSPECTOR_TUCK}px`,
    // Exactly the dock's own span: below the shell header when one claims the
    // dock, the full viewport edge on a no-shell page.
    top: `${dockShellClaimed ? APP_HEADER_HEIGHT : 0}px`,
    bottom: "0px",
    height: null,
    maxHeight: null,
    // The dock card's own top-left rounding (Chakra `xl`), so the pair reads
    // as one widening card; the flush no-shell pane stays square.
    borderTopLeftRadius: dockShellClaimed ? "12px" : "0px",
    borderBottomLeftRadius: "0px",
  };
}

/**
 * The floating card's resting floor, in px.
 *
 * The card is deliberately short at rest and GROWS with its conversation, so
 * an empty thread is a compact card rather than a tall stub. The sizes are
 * steps, not a curve: nothing (340), a card holding a turn (410), a card
 * holding a thread (520).
 *
 * `expectedMessageCount` is what the card has to hold — the messages it has,
 * or, while a remembered conversation's history is still loading, the count
 * the recents list already knows is coming. Sizing from the loaded messages
 * alone made a restored conversation open on the empty floor and step up as
 * its history landed, which is the same bounce the high-water mark exists to
 * prevent — just moved to the moment of opening.
 */
/**
 * The steps were tuned against plain prose answers, where a short turn really
 * is short. A turn that ends in a CARD — an error, a capability result — needs
 * appreciably more room than one line of text, and at the old floors the card
 * filled the card: composer hard against it, nothing breathing. Every step is
 * a little taller so the panel always opens with somewhere to put an answer.
 */
export const LANGY_FLOATING_FLOOR_EMPTY_PX = 380;
export const LANGY_FLOATING_FLOOR_TURN_PX = 480;
export const LANGY_FLOATING_FLOOR_THREAD_PX = 560;

export function langyRestingFloorPx({
  emptyAndSettled,
  expectedMessageCount,
}: {
  emptyAndSettled: boolean;
  expectedMessageCount: number;
}): number {
  if (emptyAndSettled) return LANGY_FLOATING_FLOOR_EMPTY_PX;
  return expectedMessageCount <= 1
    ? LANGY_FLOATING_FLOOR_TURN_PX
    : LANGY_FLOATING_FLOOR_THREAD_PX;
}
