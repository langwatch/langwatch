import { Box, HStack, Text } from "@chakra-ui/react";
import { memo, useMemo } from "react";
import { computeLineDiff, type DiffLine, diffStat } from "./diff";
import { TERMINAL_TOKENS } from "./palette";

interface TerminalDiffProps {
  /** File contents before the edit. Empty for a freshly written file. */
  oldText: string;
  /** File contents after the edit. */
  newText: string;
  /** Path shown in the diff header. */
  filePath?: string;
  maxHeight?: string;
}

/**
 * Claude Code-style code diff: removed lines tinted red, added lines tinted
 * green, context dimmed, each with its line number and a `+`/`-`/` ` gutter.
 * Recreates the diff block Claude Code prints after an Edit/Write so the
 * terminal view shows what actually changed, not a raw JSON tool result.
 *
 * Colours come from Chakra's semantic `green.*`/`red.*` tokens, so the diff
 * stays legible and on-brand in both light and dark themes.
 */
export const TerminalDiff = memo(function TerminalDiff({
  oldText,
  newText,
  filePath,
  maxHeight = "480px",
}: TerminalDiffProps) {
  const lines = useMemo(
    () => computeLineDiff(oldText, newText),
    [oldText, newText],
  );
  const stat = useMemo(() => diffStat(lines), [lines]);

  return (
    <Box
      borderRadius="md"
      borderWidth="1px"
      borderColor={TERMINAL_TOKENS.border}
      bg={TERMINAL_TOKENS.screenBg}
      overflow="hidden"
    >
      <HStack
        gap={2}
        paddingX={2.5}
        paddingY={1}
        borderBottomWidth="1px"
        borderBottomColor={TERMINAL_TOKENS.border}
        bg={TERMINAL_TOKENS.frameBg}
      >
        {filePath && (
          <Text
            textStyle="2xs"
            fontFamily="mono"
            color={TERMINAL_TOKENS.faint}
            truncate
            flex={1}
            minWidth={0}
          >
            {filePath}
          </Text>
        )}
        <Box flex={filePath ? undefined : 1} />
        <HStack gap={1.5} flexShrink={0}>
          <Text textStyle="2xs" fontFamily="mono" color="green.fg">
            +{stat.added}
          </Text>
          <Text textStyle="2xs" fontFamily="mono" color="red.fg">
            -{stat.removed}
          </Text>
        </HStack>
      </HStack>
      <Box
        as="pre"
        margin={0}
        maxHeight={maxHeight}
        overflow="auto"
        fontFamily="mono"
        fontSize="12px"
        lineHeight="1.5"
        userSelect="text"
      >
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
  const bg = isAdd ? "green.subtle" : isRemove ? "red.subtle" : undefined;
  const gutterColor = isAdd
    ? "green.fg"
    : isRemove
      ? "red.fg"
      : TERMINAL_TOKENS.faint;
  const sign = isAdd ? "+" : isRemove ? "-" : " ";
  const lineNo = isAdd ? line.newLineNo : line.oldLineNo;

  return (
    <HStack
      as="span"
      display="flex"
      gap={0}
      align="stretch"
      bg={bg}
      paddingX={1}
    >
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
