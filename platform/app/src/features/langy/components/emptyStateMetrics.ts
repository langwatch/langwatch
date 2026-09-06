/**
 * Empty-state sizing, driven by the panel's ACTUAL width.
 *
 * The Langy panel is not one fixed size: the floating card ranges ~340–432px
 * with the viewport (see `langyPanelLayout`), and the docked sidebar is a fixed
 * 392px. The old empty state sized its hero + suggestion rows off the *mode*
 * (floating vs sidebar), so a cramped 340px floating card got the exact same
 * 44px mark and 27px greeting as a roomy 432px one — and the long
 * "Investigate an issue and open a PR" row is what fixed the tight measure.
 *
 * So the FLOATING metrics interpolate on real width instead: they sit at the
 * current look at full width and ease DOWN toward a compact anchor as the card
 * narrows, which keeps the long suggestion row on one line and stops the hero
 * from feeling oversized in a split-screen / mobile card.
 *
 * The SIDEBAR is a fixed width and wants a calmer hero regardless (it's a panel
 * you keep open, not a momentary overlay), so it keeps its own tuned constants.
 *
 * The hero mark (the LangWatch logo) runs ~16-18% larger than the original
 * anchors at every size — the logo carried the pane's identity too quietly.
 */

export interface EmptyStateMetrics {
  /** Hero mark height, px (LangyMark takes a numeric px height). */
  markSize: number;
  /** Serif greeting size, px. */
  greetingSize: number;
  /** Mark → greeting gap, px. */
  heroGapTop: number;
  /** Hero block → suggestion list gap, px. */
  heroMarginBottom: number;
  /** Suggestion row vertical padding, px. */
  rowPaddingY: number;
  /** Suggestion row horizontal padding, px. */
  rowPaddingX: number;
  /** Suggestion row icon/label/chevron gap, px. */
  rowGap: number;
  /** Subtitle measure cap, px. */
  subtitleMaxWidth: number;
}

/**
 * Interpolation band for the floating card. It never renders narrower than
 * FLOATING_PANEL_MIN_WIDTH (340) nor wider than FLOATING_PANEL_MAX_WIDTH (432),
 * and past ~416 the centred 360px measure already has all the room it needs — so
 * the roomy anchor sits there and everything clamps above it.
 */
const FLOATING_NARROW_WIDTH = 340;
const FLOATING_ROOMY_WIDTH = 416;

/** The compact end — the tightest useful floating card (~split-screen / mobile). */
const FLOATING_NARROW: EmptyStateMetrics = {
  markSize: 42,
  greetingSize: 24,
  heroGapTop: 16,
  heroMarginBottom: 26,
  rowPaddingY: 12,
  rowPaddingX: 9,
  rowGap: 11,
  subtitleMaxWidth: 280,
};

/** The roomy end — the previous floating look with the hero mark stepped up ~16%. */
const FLOATING_ROOMY: EmptyStateMetrics = {
  markSize: 51,
  greetingSize: 27,
  heroGapTop: 21,
  heroMarginBottom: 34,
  rowPaddingY: 13,
  rowPaddingX: 10,
  rowGap: 12,
  subtitleMaxWidth: 300,
};

/** The docked panel — the previous sidebar look, calmer on purpose, mark stepped up ~18%. */
const SIDEBAR_METRICS: EmptyStateMetrics = {
  markSize: 40,
  greetingSize: 23,
  heroGapTop: 12,
  heroMarginBottom: 24,
  rowPaddingY: 13,
  rowPaddingX: 10,
  rowGap: 12,
  subtitleMaxWidth: 300,
};

export function emptyStateMetrics({
  variant,
  width,
}: {
  variant: "floating" | "sidebar";
  width: number;
}): EmptyStateMetrics {
  if (variant === "sidebar") return SIDEBAR_METRICS;

  const t = clamp01(
    (width - FLOATING_NARROW_WIDTH) /
      (FLOATING_ROOMY_WIDTH - FLOATING_NARROW_WIDTH),
  );
  return {
    markSize: lerpRound(FLOATING_NARROW.markSize, FLOATING_ROOMY.markSize, t),
    greetingSize: lerpRound(
      FLOATING_NARROW.greetingSize,
      FLOATING_ROOMY.greetingSize,
      t,
    ),
    heroGapTop: lerpRound(
      FLOATING_NARROW.heroGapTop,
      FLOATING_ROOMY.heroGapTop,
      t,
    ),
    heroMarginBottom: lerpRound(
      FLOATING_NARROW.heroMarginBottom,
      FLOATING_ROOMY.heroMarginBottom,
      t,
    ),
    rowPaddingY: lerpRound(
      FLOATING_NARROW.rowPaddingY,
      FLOATING_ROOMY.rowPaddingY,
      t,
    ),
    rowPaddingX: lerpRound(
      FLOATING_NARROW.rowPaddingX,
      FLOATING_ROOMY.rowPaddingX,
      t,
    ),
    rowGap: lerpRound(FLOATING_NARROW.rowGap, FLOATING_ROOMY.rowGap, t),
    subtitleMaxWidth: lerpRound(
      FLOATING_NARROW.subtitleMaxWidth,
      FLOATING_ROOMY.subtitleMaxWidth,
      t,
    ),
  };
}

/** Clamp to [0, 1]; an unknown (NaN) width resolves to the roomy end. */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function lerpRound(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}
