// Langy's identity gradient — blue → purple → amber, the same stops the Langy
// mark and thinking shimmer use (see langyTheme `langy.aiBlue/aiPurple/
// aiOrange` and `--langy-ai-gradient`). The AI surfaces across the app share
// Langy's look rather than a separate hot-pink identity.
export const aiBrandPalette: string[] = [
  "#5B8DEF", // langy blue
  "#A855F7", // langy purple
  "#ED8926", // langy amber
];

// The ORIGINAL hot ramp (orange → hot pink → violet). On a light surface the
// langy ramp above reads washed out, so the Ask AI button keeps its heat from
// this one in light mode; dark stays on the langy identity ramp.
export const aiBrandPaletteHot: string[] = [
  "#FF5F1F", // brand orange
  "#FF1F8A", // hot pink
  "#A855F7", // vivid violet
];

// The amber accent in Display-P3, paired with the hex fallback AI_ACCENT.
export const AI_ACCENT_P3 = "color(display-p3 0.929 0.537 0.149)";

// Terminal startup marks reproduce vendor artwork, independent of the UI theme.
export const CLAUDE_MARK_GRADIENT = [
  "#F2C4AA",
  "#E8A587",
  "#DA7756",
  "#C15F3C",
  "#9C4A2E",
] as const;
export const GEMINI_MARK_GRADIENT = [
  "#4796E4",
  "#6688D9",
  "#847ACE",
  "#A471A7",
  "#C3677F",
] as const;
export const OPENCODE_GRAY = "#808080";
export const OPENCODE_GRAY_FILL = "#282828";
export const OPENCODE_WHITE = "#EEEEEE";
export const OPENCODE_WHITE_FILL = "#434343";
