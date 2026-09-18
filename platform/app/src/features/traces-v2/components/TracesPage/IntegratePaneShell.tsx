/**
 * IntegratePaneShell — the shared visual frame for a no-traces empty
 * state: a soft, slow-breathing orange glow pulled to the centre, and a
 * `safe center` hero container that floats its content to the middle
 * when there's room and falls back to the top when there isn't.
 *
 * Two empty states render their own hero + body inside this so they
 * share one visual language instead of each re-deriving the glow and
 * the centring:
 *   - the project traces page (`IntegratePane`): full-screen, with its
 *     faded SearchBar + Toolbar chrome passed via `chrome`, and the
 *     agent / MCP / SDK integration guide as the body.
 *   - the /me recent-activity card (`PersonalTracesEmptyState`):
 *     `isCompact`, no chrome, with a tiles pitch as the body.
 */
import { Box, Flex } from "@chakra-ui/react";
import type React from "react";

export const IntegratePaneShell: React.FC<{
  children: React.ReactNode;
  /**
   * Faded, non-interactive page chrome rendered above the hero. The
   * project pane passes its SearchBar + Toolbar so the empty state still
   * reads as the trace page; /me passes nothing.
   */
  chrome?: React.ReactNode;
  /**
   * Card-scale treatment: a contained glow and a tighter hero, dropped
   * into a dashboard card rather than owning the whole viewport. Skips
   * the full-height `<main>` so the card sizes the frame instead.
   */
  isCompact?: boolean;
  ariaLabel?: string;
}> = ({ children, chrome, isCompact = false, ariaLabel }) => {
  return (
    <Flex
      {...(isCompact ? {} : { as: "main", role: "main" })}
      aria-label={ariaLabel}
      direction="column"
      flex={1}
      minWidth={0}
      height={isCompact ? undefined : "full"}
      overflow={isCompact ? "hidden" : "auto"}
      position="relative"
      bg={isCompact ? "transparent" : "bg.surface"}
    >
      {/* Single soft orange glow centred on the frame that breathes and
          slow-rotates. Three slightly offset radial blobs share the
          centre so the rotation is just-perceptible (a pure-centred
          circle would rotate invisibly), and the whole layer fades to
          transparent well before the edges so there's no hard gradient
          line at the container boundary. `prefers-reduced-motion`
          freezes the breath/rotate so the glow becomes a static wash. */}
      <Box
        position="absolute"
        inset={0}
        pointerEvents="none"
        aria-hidden="true"
        zIndex={0}
        overflow="hidden"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Box
          width={isCompact ? "720px" : "140vmin"}
          height={isCompact ? "720px" : "140vmin"}
          maxWidth="140vmin"
          maxHeight="140vmin"
          borderRadius="full"
          opacity={0.1}
          filter={isCompact ? "blur(60px)" : "blur(80px)"}
          backgroundImage={`
            radial-gradient(circle at 46% 50%, var(--chakra-colors-orange-300) 0%, transparent 36%),
            radial-gradient(circle at 54% 48%, var(--chakra-colors-orange-400) 0%, transparent 30%),
            radial-gradient(circle at 50% 54%, var(--chakra-colors-orange-200) 0%, transparent 42%)
          `}
          css={{
            animation: "lw-center-breath 96s linear infinite",
            willChange: "transform",
            "@keyframes lw-center-breath": {
              "0%": { transform: "rotate(0deg) scale(0.92)" },
              "50%": { transform: "rotate(180deg) scale(1.08)" },
              "100%": { transform: "rotate(360deg) scale(0.92)" },
            },
            "@media (prefers-reduced-motion: reduce)": {
              animation: "none",
            },
          }}
        />
      </Box>
      {chrome}
      <Flex
        flex={1}
        direction="column"
        justify="safe center"
        align="stretch"
        minHeight={0}
        position="relative"
        zIndex={1}
      >
        <Box
          width="full"
          maxWidth={isCompact ? "760px" : "980px"}
          marginX="auto"
          paddingX={isCompact ? 6 : 8}
          paddingY={isCompact ? 8 : 10}
        >
          {children}
        </Box>
      </Flex>
    </Flex>
  );
};
