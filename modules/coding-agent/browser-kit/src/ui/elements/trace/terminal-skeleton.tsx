import { Box, HStack, Text, VStack } from "@chakra-ui/react";

import { TERMINAL_FONT_STACK, TERMINAL_TOKENS } from "../../../model/trace/terminal-palette.ts";

/**
 * Loading state styled as real terminal (prompt, cursor, dim placeholder rows on
 * monospace grid) rather than UI chrome over the session.
 */

const CELL = {
  fontFamily: TERMINAL_FONT_STACK,
  fontSize: "13px",
  lineHeight: "1.55",
} as const;

/** Widths in `ch` so the placeholder rows sit on the monospace grid. */
const PENDING_LINES = ["46ch", "28ch", "58ch", "34ch", "22ch"] as const;

export function TerminalSkeleton() {
  return (
    <VStack
      align="stretch"
      gap={2.5}
      height="full"
      paddingX={4}
      paddingY={3}
      bg={TERMINAL_TOKENS.screenBg}
      color={TERMINAL_TOKENS.screenFg}
      aria-busy="true"
      aria-label="Loading terminal session"
    >
      {/* The prompt is already there — a terminal always has one. */}
      <HStack align="baseline" gap={2}>
        <Text {...CELL} color={TERMINAL_TOKENS.blue} fontWeight="bold" aria-hidden>
          ❯
        </Text>
        <Cursor />
      </HStack>

      {PENDING_LINES.map((width, index) => (
        <PendingLine key={width} width={width} index={index} />
      ))}
    </VStack>
  );
}

/** A block cursor, blinking on the terminal's own grid. */
function Cursor() {
  return (
    <Box
      as="span"
      width="1ch"
      height="1.1em"
      bg={TERMINAL_TOKENS.screenFg}
      opacity={0.7}
      aria-hidden
      css={{
        animation: "terminalCursorBlink 1.06s step-end infinite",
        "@keyframes terminalCursorBlink": {
          "0%, 49%": { opacity: 0.7 },
          "50%, 100%": { opacity: 0 },
        },
        // A blinking cursor is decoration, not information — hold it still for
        // anyone who has asked the system to stop moving things.
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    />
  );
}

/**
 * A line that has not printed yet. Dim, on the monospace grid, pulsing gently
 * out of phase with its neighbours so the screen reads as filling in rather than
 * as a stack of loading bars.
 */
function PendingLine({ width, index }: { width: string; index: number }) {
  return (
    <HStack align="baseline" gap={2}>
      <Text {...CELL} color={TERMINAL_TOKENS.faint} opacity={0.35} aria-hidden>
        ⏺
      </Text>
      <Box
        height="0.9em"
        width={width}
        maxWidth="full"
        borderRadius="2px"
        bg={TERMINAL_TOKENS.faint}
        opacity={0.18}
        css={{
          animation: `terminalLinePulse 1.6s ease-in-out ${index * 0.14}s infinite`,
          "@keyframes terminalLinePulse": {
            "0%, 100%": { opacity: 0.12 },
            "50%": { opacity: 0.26 },
          },
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      />
    </HStack>
  );
}
