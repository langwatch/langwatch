/**
 * The briefing design system.
 */

/** The display voice — self-hosted Sentient, with the panel's fallbacks. */
export const SERIF =
  'var(--langy-font-serif, "Sentient", "Charter", "Source Serif Pro", Georgia, serif)';

/** Card shape + surface. `accent` is the ONE warm card (the briefing lead). */
export const CARD = {
  radius: "14px",
  padding: { base: 4, md: 5 },
  borderWidth: "1px",
  border: "border.muted",
  // A restrained warm hairline, not a bright orange ring — a hint of Langy.
  accentBorder:
    "color-mix(in srgb, var(--chakra-colors-orange-solid) 16%, var(--chakra-colors-border-muted))",
  bg: "bg.surface",
  // A whisper of warmth in the top-right corner of the lead card. Barely there.
  accentWash:
    "radial-gradient(130% 120% at 96% 0%, color-mix(in srgb, var(--chakra-colors-orange-solid) 6%, transparent), transparent 54%)",
} as const;

/** Status colour, by whether a value needs the reader. */
export const DOT = {
  good: "green.solid",
  bad: "red.solid",
  attention: "#c98a2f",
} as const;

export const FG = {
  good: "green.fg",
  bad: "red.fg",
  attention: "#c98a2f",
  neutral: "fg",
  muted: "fg.muted",
  subtle: "fg.subtle",
} as const;

/** The one amber accent, spent only on Langy, links, and the primary action. */
export const ACCENT = "orange.fg" as const;

/** Type roles. Mono for data + chrome, serif for the one display line. */
export const TYPE = {
  eyebrow: {
    fontFamily: "mono",
    fontSize: "11px",
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
  },
  sectionLabel: {
    fontFamily: "mono",
    fontSize: "10.5px",
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: FG.subtle,
  },
  headline: {
    fontFamily: SERIF,
    fontWeight: "400",
    fontSize: { base: "16px", md: "18px" },
    lineHeight: "1.3",
    letterSpacing: "-0.01em",
  },
  cardTitle: {
    fontFamily: SERIF,
    fontWeight: "500",
    fontSize: "18px",
    letterSpacing: "-0.01em",
  },
  label: {
    fontFamily: "mono",
    fontSize: "11.5px",
    letterSpacing: "0.02em",
  },
  body: { fontSize: "12.5px", lineHeight: "1.4" },
  mono: { fontFamily: "mono", fontSize: "12px" },
  value: {
    fontFamily: "mono",
    fontVariantNumeric: "tabular-nums" as const,
    letterSpacing: "-0.02em",
    lineHeight: "1",
  },
} as const;

/** Vertical rhythm between cards and within them. */
export const GAP = { section: 3, card: 3.5, row: 2 } as const;

/**
 * ── Card taxonomy ───────────────────────────────────────────────────────────
 */
export const CARD_INTENTS = ["activity", "progress", "change", "ask", "spotlight"] as const;

export type LangyCardIntent = (typeof CARD_INTENTS)[number];

export interface LangyCardVariant {
  /** Attention weight, 1 (quietest) → 5 (loudest). Ordinal, for docs + sorting. */
  weight: 1 | 2 | 3 | 4 | 5;
  /** `activity` renders as an inline line, not a boxed card. */
  inline: boolean;
  /** Inner padding of the boxed variants. */
  padding: { x: string; y: string };
  /** Card surface (a semantic bg token). */
  surface: string;
  /** Card edge (a semantic border token, or the warm accent hairline). */
  border: string;
  /** Corner radius token. */
  radius: string;
  /** Spend the warm amber accent (border + wash + ring). */
  accent: boolean;
  /**
   * Render the full panel material (grain / grid / glow via LangyPanelSurface)
   * rather than a plain hairline box. Reserved for the hero, `spotlight`.
   */
  panelMaterial: boolean;
  /** Default status-dot tone for the intent; per-instance status overrides it. */
  dot: string;
  /** Weight of the card title. */
  titleWeight: string;
  /** The one display line is set in the serif face (spotlight only). */
  serifTitle: boolean;
}

export const CARD_TAXONOMY = {
  activity: {
    weight: 1,
    inline: true,
    padding: { x: "0", y: "0" },
    surface: "transparent",
    border: "transparent",
    radius: "0",
    accent: false,
    panelMaterial: false,
    dot: FG.muted,
    titleWeight: "500",
    serifTitle: false,
  },
  progress: {
    weight: 2,
    inline: false,
    padding: { x: "13px", y: "10px" },
    surface: "bg.subtle",
    border: CARD.border,
    radius: "langyCard",
    accent: false,
    panelMaterial: false,
    dot: DOT.attention,
    titleWeight: "600",
    serifTitle: false,
  },
  change: {
    weight: 3,
    inline: false,
    padding: { x: "15px", y: "12px" },
    surface: "bg.subtle",
    border: CARD.border,
    radius: "langyCard",
    accent: false,
    panelMaterial: false,
    dot: DOT.good,
    titleWeight: "640",
    serifTitle: false,
  },
  ask: {
    weight: 4,
    inline: false,
    padding: { x: "15px", y: "14px" },
    surface: "bg.subtle",
    border: CARD.accentBorder,
    radius: "langyCard",
    accent: true,
    panelMaterial: false,
    dot: DOT.attention,
    titleWeight: "640",
    serifTitle: false,
  },
  spotlight: {
    weight: 5,
    inline: false,
    padding: { x: "18px", y: "16px" },
    surface: "bg.surface",
    border: CARD.accentBorder,
    radius: "langyCard",
    accent: true,
    panelMaterial: true,
    dot: DOT.attention,
    titleWeight: "500",
    serifTitle: true,
  },
} as const satisfies Record<LangyCardIntent, LangyCardVariant>;

/**
 * ── HDR / Display-P3 accent (task #25) ──────────────────────────────────────
 */
export const AI_ACCENT_P3 = "color(display-p3 0.929 0.537 0.149)" as const;

/**
 * Emotion fallback-value pair: `[fallback, enhanced]`. Emotion emits both declarations
 * for the property, last-wins, so a P3 renderer paints `enhanced` and every other
 * renderer keeps `fallback`.
 */
export function p3Layers(fallback: string, enhanced: string): [string, string] {
  return [fallback, enhanced];
}
