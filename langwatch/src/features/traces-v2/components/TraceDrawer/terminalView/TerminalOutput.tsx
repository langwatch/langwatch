import { Box, chakra, HStack, Icon, Text } from "@chakra-ui/react";
import { Check, Copy } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { stripAnsi } from "../../../utils/ansi/ansi";
import { AnsiText } from "./AnsiText";
import { TERMINAL_TOKENS } from "./palette";

interface TerminalOutputProps {
  /** Raw tool/command output, possibly carrying ANSI escape codes. */
  text: string;
  /**
   * Optional header label, e.g. the command that produced this output
   * (`git status`) or a stream name (`stdout`). Omit for a bare screen.
   */
  label?: string;
  /** Tint the frame to signal a failed command / error stream. */
  isError?: boolean;
  /** Cap the body height and scroll past it. Defaults to a comfortable window. */
  maxHeight?: string;
}

/**
 * Renders a single block of terminal output: a monospace "screen" where ANSI
 * escape codes are parsed into real colours instead of shown as noise. The
 * text is selectable (drag-select copies the clean, de-ANSI'd text) and a
 * hover copy button lifts the whole block at once — the two ways Claude Code
 * lets you lift terminal output.
 *
 * This is presentational: mount it only when the surrounding trace is terminal
 * origin (see `utils/terminalOrigin.ts`). It doesn't decide that itself.
 */
export const TerminalOutput = memo(function TerminalOutput({
  text,
  label,
  isError = false,
  maxHeight = "480px",
}: TerminalOutputProps) {
  const { copied, copy } = useCopyToClipboard();
  // Copy the clean text, never the escape codes — what you see is what you get.
  const plain = useMemo(() => stripAnsi(text), [text]);
  const handleCopy = useCallback(() => copy(plain), [copy, plain]);
  // Click-to-copy the whole block — but only when the user hasn't dragged a
  // selection, so hand-selecting a snippet still copies just that snippet.
  const handleScreenClick = useCallback(() => {
    const selection = window.getSelection?.();
    if (selection && selection.toString().length > 0) return;
    copy(plain);
  }, [copy, plain]);

  return (
    <Box
      role="group"
      position="relative"
      borderRadius="md"
      borderWidth="1px"
      borderColor={isError ? "red.muted" : TERMINAL_TOKENS.border}
      bg={TERMINAL_TOKENS.screenBg}
      color={TERMINAL_TOKENS.screenFg}
      overflow="hidden"
    >
      {/* Header bar always renders — it carries the copy button, with the
          optional command/stream label on the left. */}
      <HStack
        gap={2}
        paddingX={2.5}
        paddingY={1}
        borderBottomWidth={label ? "1px" : 0}
        borderBottomColor={TERMINAL_TOKENS.border}
        bg={TERMINAL_TOKENS.frameBg}
        minHeight="26px"
      >
        {label && (
          <Text
            textStyle="2xs"
            fontFamily="mono"
            color={isError ? "red.fg" : TERMINAL_TOKENS.faint}
            truncate
            flex={1}
            minWidth={0}
          >
            {label}
          </Text>
        )}
        <Box flex={label ? undefined : 1} />
        {/* Copy button: visible on hover/focus, always reachable by keyboard. */}
        <chakra.button
          type="button"
          aria-label="Copy output"
          display="flex"
          alignItems="center"
          gap={1}
          paddingX={1.5}
          paddingY={0.5}
          borderRadius="sm"
          color={TERMINAL_TOKENS.faint}
          opacity={0}
          _groupHover={{ opacity: 1 }}
          _focusVisible={{
            opacity: 1,
            outline: "2px solid",
            outlineColor: "blue.focusRing",
          }}
          _hover={{ bg: "bg.muted", color: "fg" }}
          transition="opacity 0.12s ease, background 0.12s ease"
          onClick={handleCopy}
        >
          <Icon as={copied ? Check : Copy} boxSize="12px" />
          <Text textStyle="2xs">{copied ? "Copied" : "Copy"}</Text>
        </chakra.button>
      </HStack>
      <Box
        paddingX={3}
        paddingY={2}
        maxHeight={maxHeight}
        overflow="auto"
        // Click anywhere on the screen to copy the whole block — unless the
        // user has hand-selected a snippet, in which case their selection wins.
        onClick={handleScreenClick}
      >
        <AnsiText text={text} />
      </Box>
    </Box>
  );
});
