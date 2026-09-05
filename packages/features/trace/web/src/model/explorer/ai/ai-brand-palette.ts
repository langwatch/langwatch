// Langy's identity gradient — blue → purple → amber, the same stops the Langy
// mark and thinking shimmer use (see langyTheme `langy.aiBlue/aiPurple/
// aiOrange` and `--langy-ai-gradient`). The AI surfaces across the app share
// Langy's look rather than a separate hot-pink identity.
export const aiBrandPalette: string[] = [
  "#5B8DEF", // langy blue
  "#A855F7", // langy purple
  "#ED8926", // langy amber
];

// The one accent, spent on the AI affordance's chrome — amber, Langy's accent
// (the purple survives only inside the gradient itself).
export const AI_ACCENT = "#ED8926";

// The ORIGINAL hot ramp (orange → hot pink → violet). On a light surface the
// langy ramp above reads washed out, so the Ask AI button keeps its heat from
// this one in light mode; dark stays on the langy identity ramp.
export const aiBrandPaletteHot: string[] = [
  "#FF5F1F", // brand orange
  "#FF1F8A", // hot pink
  "#A855F7", // vivid violet
];

// ── HDR / Display-P3 forms (task #25) ─────────────────────────────────────── The hex forms above stay the
// source of truth: they feed the WebGL MeshGradient (`colors={aiBrandPalette}`, which parses hex, not
// `color(display-p3 …)`) and hex-suffix box-shadows (`${aiBrandPalette[0]}33`), so they must NOT change.
export const aiBrandPaletteP3: string[] = [
  "color(display-p3 0.357 0.553 0.937)", // langy blue  (#5B8DEF)
  "color(display-p3 0.659 0.333 0.969)", // langy purple (#A855F7)
  "color(display-p3 0.929 0.537 0.149)", // langy amber (#ED8926)
];

// The amber accent in Display-P3, paired with the hex fallback AI_ACCENT.
export const AI_ACCENT_P3 = "color(display-p3 0.929 0.537 0.149)";
