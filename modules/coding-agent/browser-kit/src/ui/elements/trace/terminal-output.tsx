import { Box, Text } from "@chakra-ui/react";
import { useCopyToClipboard } from "@langwatch/design-system/use-copy-to-clipboard";
import { memo, useCallback, useMemo, useState } from "react";

import { stripAnsi } from "../../../model/trace/terminal-ansi-parser.ts";
import { TERMINAL_FONT_STACK, TERMINAL_TOKENS } from "../../../model/trace/terminal-palette.ts";
import { AnsiText } from "./terminal-ansi-text.tsx";

/** How many lines show before the output collapses — the same handful Claude Code itself shows. */
const COLLAPSE_AT_LINES = 6;

/**
 * Collapse on size too, not just line count: common Bash stdout (minified
 * JSON, base64) is one multi-megabyte LINE that a line-count predicate never
 * folds, rendering in full through the ANSI parser on first paint.
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
 * Renders terminal output monospace (no frame); selectable text de-ANSIs on
 * drag-select, click-to-copy; collapses long runs to line/size limit.
 */
export const TerminalOutput = memo(function TerminalOutput({
  text,
  isError = false,
}: TerminalOutputProps) {
  const [expanded, setExpanded] = useState(false);
  const { copy } = useCopyToClipboard();

  const { visibleText, isCollapsible, foldLabel, isDisplayCapped } = useMemo(() => {
    const lines = text.split("\n");
    const hiddenLineCount = lines.length - COLLAPSE_AT_LINES;
    const collapsible = hiddenLineCount > 0 || text.length > COLLAPSE_AT_CHARS;
    const shown =
      collapsible && !expanded
        ? lines.slice(0, COLLAPSE_AT_LINES).join("\n").slice(0, COLLAPSE_AT_CHARS)
        : text.slice(0, RENDER_CEILING_CHARS);
    const hiddenCharCount = text.length - shown.length;
    return {
      visibleText: shown,
      isCollapsible: collapsible,
      foldLabel:
        hiddenLineCount > 0 ? `+${hiddenLineCount} lines` : `+${formatCharCount(hiddenCharCount)}`,
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
