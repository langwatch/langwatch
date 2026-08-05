import { Box, Text } from "@chakra-ui/react";
import type React from "react";
import type { StageId } from "../chapters/onboardingJourneyConfig";

/**
 * Hero-text helpers shared by `StaticHero` and `TypewriterHero`.
 *
 * - `BlinkingCursor` — the typewriter caret. Lives here because both heroes
 *   use it (typewriter while typing; static could use it for a stub state).
 * - `applyAuroraTextShimmer` — wraps every standalone occurrence of
 *   `aurora` (case-insensitive) in a span that animates a multi-stop
 *   gradient across background-clipped text.
 * - `renderHeading` — most stages render their heading verbatim; a few
 *   (currently `postArrival`) prepend a coloured directional glyph.
 *   Returns React nodes, not a string.
 */

export const BlinkingCursor: React.FC<{ color?: string }> = ({
  color = "fg",
}) => (
  <Box
    as="span"
    aria-hidden
    display="inline-block"
    width="0.55ch"
    height="0.95em"
    marginLeft="0.05em"
    verticalAlign="-0.12em"
    backgroundColor={color}
    css={{
      animation: "tracesV2TypewriterBlink 1.05s steps(1) infinite",
      "@keyframes tracesV2TypewriterBlink": {
        "0%, 50%": { opacity: 1 },
        "50.01%, 100%": { opacity: 0 },
      },
    }}
  />
);

export function applyAuroraTextShimmer(text: string): React.ReactNode {
  const parts = text.split(/(\baurora\b)/i);
  return parts.map((part, i) => {
    if (/^aurora$/i.test(part)) {
      return <AuroraTextShimmer key={i}>{part}</AuroraTextShimmer>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function renderHeading(
  stage: StageId,
  heading: string,
): React.ReactNode {
  if (stage === "postArrival") {
    return (
      <>
        <Text
          as="span"
          color="blue.fg"
          fontWeight={500}
          marginRight={2}
          aria-hidden
        >
          ↑
        </Text>
        {applyAuroraTextShimmer(heading.replace(/^↑\s*/, ""))}
      </>
    );
  }
  return applyAuroraTextShimmer(heading);
}

const AuroraTextShimmer: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <Box
    as="span"
    display="inline-block"
    css={{
      backgroundImage:
        "linear-gradient(90deg, #7dd3fc, #3b82f6, #6366f1, #22d3ee, #818cf8, #7dd3fc)",
      backgroundSize: "300% 100%",
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
      WebkitTextFillColor: "transparent",
      animation: "tracesV2AuroraTextShimmer 5s linear infinite",
      "@keyframes tracesV2AuroraTextShimmer": {
        "0%": { backgroundPosition: "0% 50%" },
        "100%": { backgroundPosition: "300% 50%" },
      },
    }}
  >
    {children}
  </Box>
);
