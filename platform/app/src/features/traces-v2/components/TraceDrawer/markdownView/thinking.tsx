import { Box } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import React from "react";
import { Tooltip } from "~/components/ui/tooltip";

const thinkingShimmer = keyframes`
  0% { background-position: 200% center; }
  100% { background-position: -200% center; }
`;

/**
 * Inline span that renders a "thinking" run with a slow shimmer animation
 * sweeping across the text and a "Thinking" tooltip on hover. Lives at the
 * markdown component layer (driven by the `em` override) so it can use real
 * Chakra primitives rather than fighting Shiki's inline-styled spans.
 */
export function ThinkingText({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip content="Thinking" positioning={{ placement: "top" }}>
      <Box
        as="em"
        display="inline"
        cursor="help"
        fontStyle="italic"
        backgroundImage={`linear-gradient(
          100deg,
          color-mix(in srgb, currentColor 38%, transparent) 0%,
          color-mix(in srgb, currentColor 38%, transparent) 38%,
          currentColor 50%,
          color-mix(in srgb, currentColor 38%, transparent) 62%,
          color-mix(in srgb, currentColor 38%, transparent) 100%
        )`}
        backgroundSize="220% 100%"
        backgroundRepeat="no-repeat"
        backgroundClip="text"
        color="transparent !important"
        animation={`${thinkingShimmer} 2.4s linear infinite`}
        css={{
          WebkitBackgroundClip: "text",
          "& *": {
            color: "inherit !important",
            background: "inherit !important",
            backgroundClip: "inherit !important",
            WebkitBackgroundClip: "inherit !important",
          },
          // Reduced motion: kill the animation but keep the muted italic
          "@media (prefers-reduced-motion: reduce)": {
            animation: "none",
            backgroundImage: "none",
            color: "var(--chakra-colors-fg-muted) !important",
          },
        }}
      >
        {children}
      </Box>
    </Tooltip>
  );
}

const THINKING_MARKER_RE = /^🧠\s*/;

/**
 * If the first text node of a markdown `<em>` body starts with the 🧠
 * thinking marker, return the children with that prefix stripped. Returns
 * null when the marker is absent so the caller can fall back to plain em.
 */
export function stripThinkingMarker(
  children: React.ReactNode,
): React.ReactNode | null {
  const arr = React.Children.toArray(children);
  const first = arr[0];
  if (typeof first !== "string") return null;
  if (!THINKING_MARKER_RE.test(first)) return null;
  const stripped = first.replace(THINKING_MARKER_RE, "");
  if (!stripped && arr.length === 1) return "";
  return [stripped, ...arr.slice(1)];
}
