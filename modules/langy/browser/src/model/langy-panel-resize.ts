import {
  FLOATING_PANEL_MIN_WIDTH,
  FLOATING_PANEL_VIEWPORT_GUTTER,
  FLOATING_PANEL_VIEWPORT_SHARE,
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
  floating: {
    min: FLOATING_PANEL_MIN_WIDTH,
    cap: 760,
    viewportShare: FLOATING_PANEL_VIEWPORT_SHARE,
  },
  sidebar: { min: SIDEBAR_MIN_WIDTH, cap: 640, viewportShare: 0.5 },
} as const;

/**
 * The widest the panel may be, the narrowest that keeps the composer usable, and the default,
 * all for one viewport. A viewport not yet measured (<= 0) falls back to the absolute caps.
 */
export function resolvePanelWidthBounds({
  placement,
  viewportWidth,
}: {
  placement: LangyResizablePlacement;
  viewportWidth: number;
}): LangyPanelWidthBounds {
  const limits = LIMITS[placement];
  const measured = viewportWidth > 0;
  const fitsViewport = measured ? viewportWidth - FLOATING_PANEL_VIEWPORT_GUTTER : Infinity;
  const min = Math.min(limits.min, fitsViewport);
  const max = Math.floor(
    Math.max(
      min,
      Math.min(
        limits.cap,
        measured ? Math.max(limits.min, viewportWidth * limits.viewportShare) : Infinity,
        fitsViewport,
      ),
    ),
  );
  const preferred =
    placement === "floating" ? resolveFloatingPanelWidth(viewportWidth) : SIDEBAR_PANEL_WIDTH;
  return { min, max, default: Math.round(Math.min(max, Math.max(min, preferred))) };
}

// Kept local so model/ stays free of component imports.
/** A width forced into the bounds, as a whole pixel. */
export function clampPanelWidth({
  placement,
  viewportWidth,
  width,
}: {
  placement: LangyResizablePlacement;
  viewportWidth: number;
  width: number;
}): number {
  const { min, max } = resolvePanelWidthBounds({ placement, viewportWidth });
  return Math.min(max, Math.max(min, Math.round(width)));
}

/** The width to render: the user's stored choice, re-clamped to this viewport, else the default. */
export function resolvePanelWidth({
  placement,
  viewportWidth,
  stored,
}: {
  placement: LangyResizablePlacement;
  viewportWidth: number;
  stored: number | undefined;
}): number {
  if (stored === undefined) return resolvePanelWidthBounds({ placement, viewportWidth }).default;
  return clampPanelWidth({ placement, viewportWidth, width: stored });
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
