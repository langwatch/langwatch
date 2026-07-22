/**
 * The travelling rainbow — one gradient, one tempo, wherever it appears.
 *
 * It started life inside `ShikiCommandBox` (the install-command sheen) and was
 * copied a second time into the dataset dropzone. Two copies of the same five
 * hex stops drift apart the moment either is touched, so both now read from
 * here, and anything new that wants the effect does the same rather than
 * pasting the stops a third time.
 *
 * Recipe origin: posthog/frontend/src/styles/base.scss:2070-2110.
 */
import { keyframes } from "@emotion/react";

/** Scrolls `background-position-x` across a 200%-wide gradient. */
export const lwRainbowScroll = keyframes`
  0% { background-position-x: 0%; }
  100% { background-position-x: 200%; }
`;

/**
 * The five stops. Ends on the same blue it starts with, so the 0%→200% scroll
 * loops without a visible seam.
 */
export const LW_RAINBOW_GRADIENT =
  "linear-gradient(90deg, #0143cb 0%, #2b6ff4 24%, #d23401 47%, #ff651f 66%, #fba000 83%, #0143cb 100%)";

/** How long one full pass takes. Shared so every surface travels in step. */
export const LW_RAINBOW_DURATION = "3s";

/** The gradient clipped to the glyphs — for text that is doing something. */
export const RAINBOW_TEXT_CSS = {
  color: "transparent",
  backgroundImage: LW_RAINBOW_GRADIENT,
  backgroundClip: "text",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundSize: "200% 100%",
  animation: `${lwRainbowScroll} ${LW_RAINBOW_DURATION} linear infinite`,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} as const;

/**
 * The gradient as a filled surface — a hairline rule, a top edge, a bar.
 * The element sets its own height; this only paints and animates it.
 */
export const RAINBOW_SURFACE_CSS = {
  backgroundImage: LW_RAINBOW_GRADIENT,
  backgroundSize: "200% 100%",
  animation: `${lwRainbowScroll} ${LW_RAINBOW_DURATION} linear infinite`,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} as const;
