import { keyframes } from "@emotion/react";

// The brand's shimmer geometry, verbatim from the marketing site: a 200%-wide
// background swept from `200% 50%` to `-200% 50%`. Declared with emotion's
// `keyframes` helper rather than a string inside the style object — CSS @rules
// can't nest inside a selector, so an inline "@keyframes …" silently never
// emits and the animation name resolves to nothing.
const sweep = keyframes`
  from { background-position: 200% 50%; }
  to   { background-position: -200% 50%; }
`;

/**
 * Langy's "thinking" shimmer.
 *
 * CALM by design — the shared `thinkingShimmerStyles` (traces-v2) sweeps three
 * saturated stops fast and reads as a strobe at the 13px size the panel uses.
 * Here the line stays muted body colour for most of its width and the brand AI
 * gradient (blue → purple → orange) passes through a narrow band in the middle,
 * slowly: one gentle pass every 6s. The stops are the theme's `--langy-ai-*`
 * vars, so the sweep lifts on dark grounds along with the rest of the skin.
 *
 * Reduced motion: callers drop `animation` (see ThinkingIndicator), leaving the
 * static gradient — the text stays legible, nothing moves.
 */
export const langyThinkingShimmerStyles = {
  // The colour never reaches full strength. Each stop is the brand hue MIXED
  // most of the way back into the muted body colour (`color-mix`, 45%), so the
  // band reads as a faint iridescence passing through grey text rather than a
  // rainbow written in it. The band is also narrow — colour occupies 42%→58% of
  // a 200%-wide gradient, so at any instant most of the line is simply muted.
  background:
    "linear-gradient(90deg," +
    "var(--chakra-colors-fg-muted) 0%," +
    "var(--chakra-colors-fg-muted) 40%," +
    "color-mix(in srgb, var(--chakra-colors-langy-ai-blue) 45%, var(--chakra-colors-fg-muted)) 46%," +
    "color-mix(in srgb, var(--chakra-colors-langy-ai-purple) 45%, var(--chakra-colors-fg-muted)) 50%," +
    "color-mix(in srgb, var(--chakra-colors-langy-ai-orange) 45%, var(--chakra-colors-fg-muted)) 54%," +
    "var(--chakra-colors-fg-muted) 60%," +
    "var(--chakra-colors-fg-muted) 100%)",
  backgroundSize: "200% 100%",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  WebkitTextFillColor: "transparent",
  animation: `${sweep} 6.5s linear infinite`,
} as const;
