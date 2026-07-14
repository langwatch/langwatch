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

// ── HDR / Display-P3 forms (task #25) ───────────────────────────────────────
// The hex forms above stay the source of truth: they feed the WebGL MeshGradient
// (`colors={aiBrandPalette}`, which parses hex, not `color(display-p3 …)`) and
// hex-suffix box-shadows (`${aiBrandPalette[0]}33`), so they must NOT change.
// These parallel wide-gamut forms are for CSS consumers that CAN take the P3
// function (gradients, plain colours): use them with the hex as the fallback —
//   background: <hex gradient>;
//   background: <p3 gradient>;   // or gate the whole rule on @supports
// so a non-P3 display keeps the exact colour it always had while a P3 display
// reaches the fuller blue / purple / amber. The triples are the same sRGB bytes
// carried into the wider space (a gamut expansion), matching the hex 1:1 on sRGB.
export const aiBrandPaletteP3: string[] = [
  "color(display-p3 0.357 0.553 0.937)", // langy blue  (#5B8DEF)
  "color(display-p3 0.659 0.333 0.969)", // langy purple (#A855F7)
  "color(display-p3 0.929 0.537 0.149)", // langy amber (#ED8926)
];

// The amber accent in Display-P3, paired with the hex fallback AI_ACCENT.
export const AI_ACCENT_P3 = "color(display-p3 0.929 0.537 0.149)";
