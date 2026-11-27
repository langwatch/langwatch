import {
  FLOATING_PANEL_MIN_WIDTH,
  FLOATING_PANEL_VIEWPORT_GUTTER,
  LANGY_PAGE_RESERVE_PX,
  resolveFloatingPanelWidth,
  SIDEBAR_PANEL_WIDTH,
} from "./langy-panel-layout.ts";

/**
 * The layouts whose width the user sets by dragging; the drawer companion keeps the dock width.
 * Spec: specs/langy/langy-panel-layout.feature
 */
export type LangyResizablePlacement = "floating" | "sidebar";

export type LangyPanelWidths = Partial<Record<LangyResizablePlacement, number>>;

export interface LangyPanelWidthBounds {
  min: number;
  max: number;
  /** What a double-click restores. */
  default: number;
}

const SIDEBAR_MIN_WIDTH = 320;
const LIMITS = {
  floating: { min: FLOATING_PANEL_MIN_WIDTH },
  sidebar: { min: SIDEBAR_MIN_WIDTH },
} as const;

/**
 * Width bounds for one viewport, with no fixed pixel cap: the page keeps LANGY_PAGE_RESERVE_PX
 * beside a dock or a dodged drawer; a floating card with no drawer stops at the edge gutter.
 * An unmeasured viewport (<= 0) caps at the default.
 */
export function resolvePanelWidthBounds({
  placement,
  viewportWidth,
  besideDrawer = false,
}: {
  placement: LangyResizablePlacement;
  viewportWidth: number;
  besideDrawer?: boolean;
}): LangyPanelWidthBounds {
  const measured = viewportWidth > 0;
  const fitsViewport = measured ? viewportWidth - FLOATING_PANEL_VIEWPORT_GUTTER : Infinity;
  const min = Math.min(LIMITS[placement].min, fitsViewport);
  const keepsPageRoom = placement === "sidebar" || besideDrawer;
  const widest = keepsPageRoom ? viewportWidth - LANGY_PAGE_RESERVE_PX : fitsViewport;
  const preferred =
    placement === "floating" ? resolveFloatingPanelWidth(viewportWidth) : SIDEBAR_PANEL_WIDTH;
  const max = Math.floor(Math.max(min, measured ? widest : preferred));
  return { min, max, default: Math.round(Math.min(max, Math.max(min, preferred))) };
}

// Kept local so model/ stays free of component imports.
/** A width forced into the bounds, as a whole pixel. */
export function clampPanelWidth({
  placement,
  viewportWidth,
  width,
  besideDrawer,
}: {
  placement: LangyResizablePlacement;
  viewportWidth: number;
  width: number;
  besideDrawer?: boolean;
}): number {
  const { min, max } = resolvePanelWidthBounds({ placement, viewportWidth, besideDrawer });
  return Math.min(max, Math.max(min, Math.round(width)));
}

/** The width to render: the user's stored choice, re-clamped to this viewport, else the default. */
export function resolvePanelWidth({
  placement,
  viewportWidth,
  stored,
  besideDrawer,
}: {
  placement: LangyResizablePlacement;
  viewportWidth: number;
  stored: number | undefined;
  besideDrawer?: boolean;
}): number {
  if (stored === undefined) {
    return resolvePanelWidthBounds({ placement, viewportWidth, besideDrawer }).default;
  }
  return clampPanelWidth({ placement, viewportWidth, width: stored, besideDrawer });
}

/** Whatever the storage held, reduced to the widths that are usable numbers. */
export function parseStoredPanelWidths(raw: unknown): LangyPanelWidths {
  if (typeof raw !== "object" || raw === null) return {};
  const record = raw as Record<string, unknown>;
  const widths: LangyPanelWidths = {};
  for (const placement of ["floating", "sidebar"] as const) {
    const value = record[placement];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      widths[placement] = value;
    }
  }
  return widths;
}
