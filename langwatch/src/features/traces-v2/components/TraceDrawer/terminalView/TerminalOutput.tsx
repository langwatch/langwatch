import { Box, Text } from "@chakra-ui/react";
import { memo, useCallback, useMemo, useState } from "react";
import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { stripAnsi } from "../../../utils/ansi/ansi";
import { AnsiText } from "./AnsiText";
import { TERMINAL_FONT_STACK, TERMINAL_TOKENS } from "./palette";

/** How many lines show before the output collapses — the same handful Claude Code itself shows. */
const COLLAPSE_AT_LINES = 6;

interface TerminalOutputProps {
  /** Raw tool/command output, possibly carrying ANSI escape codes. */
  text: string;
  /** Tint the text to signal a failed command / error stream. */
  isError?: boolean;
}

/**
 * Renders a block of terminal output as plain monospace text — no card, no
 * border, no header bar. Claude Code doesn't draw a "results panel" around a
 * command's output; it just prints it, and a long run collapses to a
 * handful of lines with a fold marker rather than a scrollbar.
 *
 * The text is selectable (drag-select copies the clean, de-ANSI'd text) and
 * a click on the block (outside a drag-selection) copies it whole — the two
 * ways Claude Code lets you lift terminal output, without a visible button
 * for either.
 */
export const TerminalOutput = memo(function TerminalOutput({
  text,
  isError = false,
}: TerminalOutputProps) {
  const [expanded, setExpanded] = useState(false);
  const { copy } = useCopyToClipboard();
  const plain = useMemo(() => stripAnsi(text), [text]);

  const lines = useMemo(() => text.split("\n"), [text]);
  const hiddenLineCount = lines.length - COLLAPSE_AT_LINES;
  const isCollapsible = hiddenLineCount > 0;
  const visibleText =
    isCollapsible && !expanded ? lines.slice(0, COLLAPSE_AT_LINES).join("\n") : text;

  const handleClick = useCallback(() => {
    const selection = window.getSelection?.();
    if (selection && selection.toString().length > 0) return;
    copy(plain);
  }, [copy, plain]);

  return (
    <Box color={isError ? TERMINAL_TOKENS.red : TERMINAL_TOKENS.screenFg} cursor="text" onClick={handleClick}>
      <AnsiText text={visibleText} />
      {isCollapsible && (
        <Text
          fontFamily={TERMINAL_FONT_STACK}
          fontSize="13px"
          color={TERMINAL_TOKENS.faint}
          cursor="pointer"
          userSelect="none"
          _hover={{ color: TERMINAL_TOKENS.screenFg }}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          {expanded ? "▲ show less" : `… +${hiddenLineCount} lines (click to expand)`}
        </Text>
      )}
    </Box>
  );
});
