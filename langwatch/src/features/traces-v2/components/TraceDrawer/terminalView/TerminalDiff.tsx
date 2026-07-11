import { Box, HStack, Text } from "@chakra-ui/react";
import { memo, useMemo } from "react";
import { computeLineDiff, type DiffLine, diffStat } from "./diff";
import { DIFF_TOKENS, TERMINAL_FONT_STACK, TERMINAL_TOKENS } from "./palette";

interface TerminalDiffProps {
  /** File contents before the edit. Empty for a freshly written file. */
  oldText: string;
  /** File contents after the edit. */
  newText: string;
  /** Path shown above the diff. */
  filePath?: string;
}

/**
 * Claude Code-style code diff: removed lines on a full-width red block,
 * added lines on a full-width green block, context dimmed, each with its
 * line number and a `+`/`-`/` ` gutter — the same block a real diff pager
 * draws, not a card with a border around it.
 *
 * Used only when no real structured patch is available (see
 * {@link TerminalPatch}, the primary path) — this one synthesizes a diff
 * from the Edit tool's own `old_string`/`new_string`.
 */
export const TerminalDiff = memo(function TerminalDiff({
  oldText,
  newText,
  filePath,
}: TerminalDiffProps) {
  const lines = useMemo(
    () => computeLineDiff(oldText, newText),
    [oldText, newText],
  );
  const stat = useMemo(() => diffStat(lines), [lines]);

  return (
    <Box>
      <HStack gap={2} paddingBottom={1}>
        {filePath && (
          <Text
            fontFamily={TERMINAL_FONT_STACK}
            fontSize="13px"
            color={TERMINAL_TOKENS.faint}
            truncate
            minWidth={0}
          >
            {filePath}
          </Text>
        )}
        <Text fontFamily={TERMINAL_FONT_STACK} fontSize="13px" color={DIFF_TOKENS.addFg} flexShrink={0}>
          +{stat.added}
        </Text>
        <Text fontFamily={TERMINAL_FONT_STACK} fontSize="13px" color={DIFF_TOKENS.removeFg} flexShrink={0}>
          -{stat.removed}
        </Text>
      </HStack>
      <Box as="pre" margin={0} fontFamily={TERMINAL_FONT_STACK} fontSize="13px" lineHeight="1.5" userSelect="text">
        {lines.map((line, index) => (
          <DiffRow key={index} line={line} />
        ))}
      </Box>
    </Box>
  );
});

function DiffRow({ line }: { line: DiffLine }) {
  const isAdd = line.kind === "add";
  const isRemove = line.kind === "remove";
  const bg = isAdd ? DIFF_TOKENS.addBg : isRemove ? DIFF_TOKENS.removeBg : undefined;
  const gutterColor = isAdd
    ? DIFF_TOKENS.addFg
    : isRemove
      ? DIFF_TOKENS.removeFg
      : TERMINAL_TOKENS.faint;
  const sign = isAdd ? "+" : isRemove ? "-" : " ";
  const lineNo = isAdd ? line.newLineNo : line.oldLineNo;

  return (
    <HStack as="span" display="flex" gap={0} align="stretch" bg={bg}>
      <Text
        as="span"
        color={TERMINAL_TOKENS.faint}
        opacity={0.7}
        textAlign="right"
        width="3.5em"
        flexShrink={0}
        paddingRight={2}
        userSelect="none"
      >
        {lineNo ?? ""}
      </Text>
      <Text
        as="span"
        color={gutterColor}
        width="1.2em"
        flexShrink={0}
        userSelect="none"
      >
        {sign}
      </Text>
      <Text
        as="span"
        color={isAdd || isRemove ? gutterColor : TERMINAL_TOKENS.screenFg}
        whiteSpace="pre-wrap"
        wordBreak="break-word"
        flex={1}
        minWidth={0}
      >
        {line.text || " "}
      </Text>
    </HStack>
  );
}
