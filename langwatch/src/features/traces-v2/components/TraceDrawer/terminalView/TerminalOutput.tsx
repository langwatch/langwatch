import { Box, Text } from "@chakra-ui/react";
import { memo, useCallback, useMemo, useState } from "react";
import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { stripAnsi } from "../../../utils/ansi/ansi";
import { AnsiText } from "./AnsiText";
import { TERMINAL_FONT_STACK, TERMINAL_TOKENS } from "./palette";

/** How many lines show before the output collapses — the same handful Claude Code itself shows. */
const COLLAPSE_AT_LINES = 6;

/**
 * Collapse on size too, not just line count: common Bash stdout (minified
 * JSON, base64) is one multi-megabyte LINE, which a line-count predicate never
 * folds — and it would render in full, synchronously, through the ANSI parser
 * on first paint.
 */
const COLLAPSE_AT_CHARS = 10_000;

/**
 * Hard ceiling on how much output is ever RENDERED, even expanded — parsing
 * and painting a multi-megabyte blob hangs the tab. Copy is unaffected: the
 * click-to-copy always lifts the complete text.
 */
const RENDER_CEILING_CHARS = 500_000;

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

  const { visibleText, isCollapsible, foldLabel, isDisplayCapped } =
    useMemo(() => {
      const lines = text.split("\n");
      const hiddenLineCount = lines.length - COLLAPSE_AT_LINES;
      const collapsible =
        hiddenLineCount > 0 || text.length > COLLAPSE_AT_CHARS;
      const shown =
        collapsible && !expanded
          ? lines
              .slice(0, COLLAPSE_AT_LINES)
              .join("\n")
              .slice(0, COLLAPSE_AT_CHARS)
          : text.slice(0, RENDER_CEILING_CHARS);
      const hiddenCharCount = text.length - shown.length;
      return {
        visibleText: shown,
        isCollapsible: collapsible,
        foldLabel:
          hiddenLineCount > 0
            ? `+${hiddenLineCount} lines`
            : `+${formatCharCount(hiddenCharCount)}`,
        isDisplayCapped: expanded && text.length > RENDER_CEILING_CHARS,
      };
    }, [text, expanded]);

  const handleClick = useCallback(() => {
    const selection = window.getSelection?.();
    if (selection && selection.toString().length > 0) return;
    // De-ANSI'd on demand: most outputs are only ever looked at, and while
    // collapsed only a slice of the text is even rendered — stripping the
    // whole thing on mount would pay the full-blob walk for nothing.
    copy(stripAnsi(text));
  }, [copy, text]);

  return (
    <Box
      color={isError ? TERMINAL_TOKENS.red : TERMINAL_TOKENS.screenFg}
      cursor="text"
      onClick={handleClick}
    >
      <AnsiText text={visibleText} />
      {isDisplayCapped && (
        <Text
          fontFamily={TERMINAL_FONT_STACK}
          fontSize="13px"
          color={TERMINAL_TOKENS.faint}
          userSelect="none"
        >
          … display capped, click the output to copy all of it
        </Text>
      )}
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
          {expanded ? "▲ show less" : `… ${foldLabel} (click to expand)`}
        </Text>
      )}
    </Box>
  );
});

/** "4,096 chars" reads worse than "4k chars" at terminal scale. */
function formatCharCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M chars`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k chars`;
  return `${count} chars`;
}
