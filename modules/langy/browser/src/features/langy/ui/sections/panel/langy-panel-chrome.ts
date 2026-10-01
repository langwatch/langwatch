import {
  APP_HEADER_HEIGHT,
  FLOATING_PANEL_CSS_WIDTH,
  FLOATING_PANEL_INSET,
  LANGY_TRANSITION,
  PANEL_LAYOUT_TRANSITION,
  SIDEBAR_PANEL_WIDTH,
} from "../../../../../model/langy-panel-layout.ts";

/** How much of the viewport the floating card may claim once its conversation has earned it. */
const FLOATING_MAX_VIEWPORT_DVH = 90;
/** Breathing room subtracted from the cap so the card never touches the edge. */
const FLOATING_EDGE_GUTTER_PX = 12;
const FLOATING_MAX_HEIGHT = `calc(${FLOATING_MAX_VIEWPORT_DVH}dvh - ${FLOATING_EDGE_GUTTER_PX}px)`;

// Floating grows OUT OF the peek it replaces (scaled down, offset toward the
// corner); the dock slides in from the edge its own peek sliver rests on.
const FLOATING_CLOSED = {
  opacity: 0,
  scale: 0.92,
  x: 10,
  y: 18,
  visibility: "hidden",
} as const;
const SIDEBAR_CLOSED = {
  opacity: 0,
  scale: 1,
  x: SIDEBAR_PANEL_WIDTH,
  y: 0,
  visibility: "hidden",
} as const;
// Motion sets visibility at the start when showing and at the end when hiding, so a closed
// panel is hidden from sight, focus and the accessibility tree once it has left.
const AT_REST = { opacity: 1, scale: 1, x: 0, y: 0, visibility: "visible" } as const;

// Opening settles with a spring; closing is a short ease-in.
const OPEN_TRANSITION = { type: "spring", stiffness: 300, damping: 30, mass: 0.9 } as const;
const CLOSE_TRANSITION = { duration: 0.16, ease: [0.4, 0, 1, 1] } as const;

const SIZE_EASE = "340ms cubic-bezier(0.32, 0.72, 0, 1)";

/** The column's inner measure: the floating card breathes, the slimmer dock runs denser. */
export function panelGutter(floating: boolean): string {
  return floating ? "19px" : "14px";
}

/** Peeking is the panel itself, opaque and un-offset; standing aside for the home's ask field
 * must not read as the panel leaving. */
const PEEK_VARIANTS = {
  open: AT_REST,
  peek: AT_REST,
  peekDismissed: { ...AT_REST, opacity: 0, visibility: "hidden" },
};
const FLOATING_VARIANTS = { ...PEEK_VARIANTS, closed: FLOATING_CLOSED };
const SIDEBAR_VARIANTS = { ...PEEK_VARIANTS, closed: SIDEBAR_CLOSED };

/** The panel's motion variants, one stable object per layout. */
export function panelVariants(floating: boolean) {
  return floating ? FLOATING_VARIANTS : SIDEBAR_VARIANTS;
}

export function panelMotionState({
  isOpen,
  peekDismissed,
  peeking,
}: {
  isOpen: boolean;
  peekDismissed: boolean;
  peeking: boolean;
}): "open" | "peekDismissed" | "peek" | "closed" {
  if (isOpen) return "open";
  if (peekDismissed) return "peekDismissed";
  if (peeking) return "peek";
  return "closed";
}

export function panelTransition({
  reduceMotion,
  isOpen,
}: {
  reduceMotion: boolean;
  isOpen: boolean;
}) {
  if (reduceMotion) return { duration: 0 };
  return { ...(isOpen ? OPEN_TRANSITION : CLOSE_TRANSITION), layout: PANEL_LAYOUT_TRANSITION };
}

/**
 * The size change eases as genuine layout rather than a scale that squashes content; short windows
 * use the whole canvas, since the capped silhouette would leave no conversation viewport at all.
 */
export function panelSizeCss({
  floating,
  reduceMotion,
}: {
  floating: boolean;
  reduceMotion: boolean;
}) {
  if (!floating) {
    return reduceMotion
      ? undefined
      : { transition: `translate ${LANGY_TRANSITION}, width ${SIZE_EASE}` };
  }
  const transition = `min-height ${SIZE_EASE}, max-height ${SIZE_EASE}, width ${SIZE_EASE}, translate ${LANGY_TRANSITION}`;
  return {
    ...(reduceMotion ? {} : { transition }),
    "@media (max-height: 620px)": {
      height: "calc(100dvh - 24px)",
      minHeight: "0",
      maxHeight: "calc(100dvh - 24px)",
    },
  };
}

/** Beside an open drawer: EXACTLY the drawer's chrome, so the pair reads as two of one thing. */
const DRAWER_COMPANION_CHROME = {
  top: "8px",
  right: "8px",
  bottom: "8px",
  backdropFilter: "blur(25px)",
  borderWidth: "1px",
  borderColor: "border",
  borderRadius: "lg",
  boxShadow: "lg",
} as const;

/** An app shell is mounted: the dock joins it as a SECOND content card. */
const SHELL_DOCK_CHROME = {
  top: `${APP_HEADER_HEIGHT}px`,
  right: 0,
  bottom: 0,
  borderTopWidth: "1px",
  borderLeftWidth: "1px",
  borderColor: "border.muted",
  borderTopLeftRadius: "xl",
  borderBottomLeftRadius: 0,
  boxShadow: "none",
  _dark: { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07)" },
} as const;

/** No shell on this page (a full-screen tool): a flush full-height pane on the viewport edge. */
const FLUSH_DOCK_CHROME = {
  top: 0,
  right: 0,
  bottom: 0,
  borderLeftWidth: "1px",
  borderTopLeftRadius: 0,
  borderBottomLeftRadius: 0,
  boxShadow: "none",
} as const;

/**
 * Floating reads as glass, anchored in a bottom corner and growing UPWARD under a viewport cap;
 * the inset hairline gives its top edge a lit rim on the dark ground.
 */
function floatingChrome({
  dodgesDrawer,
  minHeightPx,
}: {
  dodgesDrawer: boolean;
  minHeightPx: number;
}) {
  const inset = `${FLOATING_PANEL_INSET}px`;
  return {
    ...(dodgesDrawer ? { left: inset } : { right: inset }),
    bottom: inset,
    height: "auto",
    minHeight: `min(${minHeightPx}px, ${FLOATING_MAX_HEIGHT})`,
    maxHeight: FLOATING_MAX_HEIGHT,
    background: "bg.surface/85",
    backdropFilter: "blur(8px)",
    borderWidth: "1px",
    borderRadius: "20px",
    boxShadow:
      "0 1px 2px rgba(20,20,23,0.04), 0 12px 28px rgba(20,20,23,0.10), 0 32px 64px rgba(20,20,23,0.10)",
    _dark: {
      background: "bg.surface/88",
      backdropFilter: "blur(16px) saturate(1.1)",
      boxShadow:
        "0 1px 2px rgba(0,0,0,0.4), 0 12px 28px rgba(0,0,0,0.5), 0 32px 64px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)",
    },
  };
}

/** The panel's placement chrome: drawer companion, floating card, or dock. */
export function panelPlacementChrome({
  floating,
  isDrawerCompanion,
  dockShellClaimed,
  dodgesDrawer,
  minHeightPx,
}: {
  floating: boolean;
  isDrawerCompanion: boolean;
  dockShellClaimed: boolean;
  dodgesDrawer: boolean;
  minHeightPx: number;
}) {
  if (isDrawerCompanion) return DRAWER_COMPANION_CHROME;
  if (floating) return floatingChrome({ dodgesDrawer, minHeightPx });
  return dockShellClaimed ? SHELL_DOCK_CHROME : FLUSH_DOCK_CHROME;
}

/** The dock is slimmer than the floating card; the drawer companion keeps the dock width. */
export function panelWidth({
  floating,
  isDrawerCompanion,
}: {
  floating: boolean;
  isDrawerCompanion: boolean;
}): string {
  return isDrawerCompanion || !floating ? `${SIDEBAR_PANEL_WIDTH}px` : FLOATING_PANEL_CSS_WIDTH;
}
