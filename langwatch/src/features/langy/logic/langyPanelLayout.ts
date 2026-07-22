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
