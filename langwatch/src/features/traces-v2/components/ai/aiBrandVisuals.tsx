import { Box } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { MeshGradient } from "@paper-design/shaders-react";
import { Sparkles } from "lucide-react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { aiBrandPalette } from "./aiBrandPalette";

// Single source of truth for the gradient id used by every gradient-stroke
// Sparkle. Defined once in <SparkleGradientDefs /> and referenced via
// `stroke="url(#langy-sparkle-grad)"`.
export const SPARKLE_GRADIENT_ID = "langy-sparkle-grad";

// AI accent shadows — purple-leaning so they feel cool, not warm.
export const AI_SHADOW = "0 6px 18px -4px rgba(168, 85, 247, 0.35)";
export const AI_SHADOW_SOFT = "0 4px 12px -4px rgba(168, 85, 247, 0.22)";

// AI brand surface tones. Kept literal because we want the same exact tones
// across light/dark; semantic purple.subtle from Chakra is too pale.
export const AI_BG_SUBTLE = "rgba(168, 85, 247, 0.06)";
export const AI_BG_HOVER = "rgba(168, 85, 247, 0.10)";
export const AI_BORDER = "rgba(168, 85, 247, 0.24)";

// Use the emotion `keyframes` helper so the @keyframes rule is actually
// emitted into the document head — embedding `"@keyframes …"` inside a
// css object silently fails (CSS @rules can't nest inside selectors), so
// the shimmer would otherwise run on a non-existent animation name.
const aiThinkingShimmer = keyframes`
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
`;

// Sweep the three AI brand stops (orange → pink → violet) through the
// muted body colour so the shimmer reads as the same "AI" gradient the
// Sparkles icon and Ask AI button use, instead of a single flat accent.
export const thinkingShimmerStyles = {
  background: `linear-gradient(
    90deg,
    var(--chakra-colors-fg-muted) 0%,
    var(--chakra-colors-fg-muted) 25%,
    ${aiBrandPalette[0]} 42%,
    ${aiBrandPalette[1]} 50%,
    ${aiBrandPalette[2]} 58%,
    var(--chakra-colors-fg-muted) 75%,
    var(--chakra-colors-fg-muted) 100%
  )`,
  backgroundSize: "250% 100%",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  WebkitTextFillColor: "transparent",
  animation: `${aiThinkingShimmer} 4.5s linear infinite`,
} as const;

/**
 * Hidden SVG that defines the AI brand linear gradient. Every `<Sparkles>`
 * (or other lucide icon) that wants the rainbow brand stroke references it
 * via `stroke="url(#<id>)"`. Defined once at the root of a surface so the
 * gradient is available globally and the icons reuse the same paint server.
 */
export function SparkleGradientDefs({
  id = SPARKLE_GRADIENT_ID,
}: {
  id?: string;
}) {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden
      style={{ position: "absolute", pointerEvents: "none" }}
    >
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          {aiBrandPalette.map((color, i) => (
            <stop
              key={color}
              offset={`${(i / (aiBrandPalette.length - 1)) * 100}%`}
              stopColor={color}
            />
          ))}
        </linearGradient>
      </defs>
    </svg>
  );
}

/** AI-brand sparkle: outline-only icon with the rainbow gradient stroke. */
export function GradientSparkle({
  size = 16,
  gradientId = SPARKLE_GRADIENT_ID,
}: {
  size?: number;
  gradientId?: string;
}) {
  return (
    <Sparkles size={size} stroke={`url(#${gradientId})`} strokeWidth={2} />
  );
}

/**
 * Animated WebGL mesh of the AI brand colours, positioned absolute and
 * sized to fill its parent. Drop into any AI affordance with
 * `position: relative` and ensure the foreground content sits at
 * `position: relative; zIndex: 1` so it stacks above the mesh.
 *
 * `active` lifts the swirl speed for the "thinking" state; pass a fixed
 * `speed` instead for surfaces with a single constant speed. Returns a
 * static gradient when `prefers-reduced-motion: reduce` is set.
 */
export function MeshGradientLayer({
  active = false,
  borderRadius,
  speed,
  darkOpacity = 0.75,
  zIndex,
}: {
  active?: boolean;
  borderRadius?: string;
  /** Fixed swirl speed — overrides the `active`-derived speed when set. */
  speed?: number;
  darkOpacity?: number;
  zIndex?: number;
}) {
  const reduceMotion = useReducedMotion();
  const resolvedSpeed = reduceMotion ? 0 : (speed ?? (active ? 0.6 : 0.3));
  return (
    <Box
      position="absolute"
      inset={0}
      zIndex={zIndex}
      pointerEvents="none"
      overflow="hidden"
      borderRadius={borderRadius}
      _dark={{ opacity: darkOpacity }}
    >
      <MeshGradient
        colors={[...aiBrandPalette]}
        distortion={0.5}
        swirl={0.5}
        grainMixer={0}
        grainOverlay={0}
        speed={resolvedSpeed}
        scale={1.5}
        style={{ width: "100%", height: "100%" }}
      />
    </Box>
  );
}

/** Small rounded tile housing a gradient sparkle — Langy's avatar. */
export function SparkleTile({
  size,
  sparkleSize,
}: {
  size: number;
  sparkleSize: number;
}) {
  return (
    <Box
      width={`${size}px`}
      height={`${size}px`}
      borderRadius="8px"
      background={AI_BG_SUBTLE}
      borderWidth="1px"
      borderStyle="solid"
      borderColor={AI_BORDER}
      display="grid"
      placeItems="center"
      flexShrink={0}
    >
      <GradientSparkle size={sparkleSize} />
    </Box>
  );
}
