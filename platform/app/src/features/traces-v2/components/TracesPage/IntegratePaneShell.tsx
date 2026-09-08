/**
 * IntegratePaneShell — the shared frame for a no-traces empty state: a
 * `safe center` hero container that floats its content to the middle
 * when there's room and falls back to the top when there isn't.
 *
 * Two empty states render their own hero + body inside this so they
 * share one layout instead of each re-deriving the centring:
 *   - the project traces page (`IntegratePane`): full-screen, with its
 *     faded SearchBar + Toolbar chrome passed via `chrome`, and the
 *     token plus the setup actions as the body.
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
   * Card-scale treatment: a tighter hero, dropped into a dashboard card
   * rather than owning the whole viewport. Skips the full-height
   * `<main>` so the card sizes the frame instead.
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
          minWidth={0}
          marginX="auto"
          paddingX={isCompact ? 6 : { base: 4, md: 8 }}
          paddingY={isCompact ? 8 : { base: 6, md: 10 }}
        >
          {children}
        </Box>
      </Flex>
    </Flex>
  );
};
