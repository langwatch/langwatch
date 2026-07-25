import { Box, HStack, Text } from "@chakra-ui/react";
import { memo } from "react";
import { DIFF_TOKENS, TERMINAL_FONT_STACK, TERMINAL_TOKENS } from "./palette";
import type { PatchHunk } from "./toolSpans";

const CELL = {
  fontFamily: TERMINAL_FONT_STACK,
  fontSize: "13px",
  lineHeight: "1.55",
} as const;

/**
 * Claude Code's REAL patch for an Edit, as the CLI itself drew it: line numbers
 * down the gutter, added lines green, removed lines red, context dimmed.
 *
 * Distinct from {@link TerminalDiff}, which synthesizes a diff from the Edit
 * tool's `old_string` / `new_string` when no span patch is available. This one
 * renders the structured patch the tool actually produced, so the line numbers
 * are the file's real line numbers and the context lines are real context.
 */
export const TerminalPatch = memo(function TerminalPatch({
  hunks,
  filePath,
}: {
  hunks: PatchHunk[];
  filePath?: string | null;
}) {
  const added = hunks.reduce(
    (n, h) => n + h.lines.filter((l) => l.startsWith("+")).length,
    0,
  );
  const removed = hunks.reduce(
    (n, h) => n + h.lines.filter((l) => l.startsWith("-")).length,
    0,
  );

  return (
    <Box>
      <HStack gap={2} paddingBottom={1}>
        {filePath && (
          <Text {...CELL} color={TERMINAL_TOKENS.faint} truncate minWidth={0}>
            {filePath}
          </Text>
        )}
        {added > 0 && (
          <Text {...CELL} color={DIFF_TOKENS.addFg} flexShrink={0}>
            {`+${added}`}
          </Text>
        )}
        {removed > 0 && (
          <Text {...CELL} color={DIFF_TOKENS.removeFg} flexShrink={0}>
            {`-${removed}`}
          </Text>
        )}
      </HStack>

      <Box overflowX="auto">
        {hunks.map((hunk, hunkIndex) => (
          <Box key={hunkIndex} paddingY={0.5}>
            {hunk.lines.map((line, lineIndex) => (
              <PatchLine
                key={lineIndex}
                line={line}
                lineNumber={newLineNumbers(hunk)[lineIndex] ?? null}
              />
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  );
});

/**
 * The new-file line number for every line of a hunk: counting starts at
 * `newStart`, and removed lines get null without advancing it (they don't
 * exist in the new file). One linear pass per hunk, memoised because the
 * render maps over the same hunk once per line.
 */
const newLineNumberCache = new WeakMap<PatchHunk, Array<number | null>>();
function newLineNumbers(hunk: PatchHunk): Array<number | null> {
  const cached = newLineNumberCache.get(hunk);
  if (cached) return cached;

  let n = hunk.newStart;
  const numbers = hunk.lines.map((line) => (line.startsWith("-") ? null : n++));
  newLineNumberCache.set(hunk, numbers);
  return numbers;
}

function PatchLine({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number | null;
}) {
  const isAdd = line.startsWith("+");
  const isRemove = line.startsWith("-");

  return (
    <HStack
      gap={2}
      align="flex-start"
      width="max-content"
      minWidth="full"
      // Full-width, saturated — the same block a real diff pager draws, not
      // a subtle tint clinging to the text.
      bg={
        isAdd ? DIFF_TOKENS.addBg : isRemove ? DIFF_TOKENS.removeBg : undefined
      }
    >
      <Text
        {...CELL}
        color={TERMINAL_TOKENS.faint}
        textAlign="right"
        minWidth="4ch"
        flexShrink={0}
        userSelect="none"
        aria-hidden
      >
        {lineNumber ?? ""}
      </Text>
      <Text
        {...CELL}
        whiteSpace="pre"
        flex={1}
        color={
          isAdd
            ? DIFF_TOKENS.addFg
            : isRemove
              ? DIFF_TOKENS.removeFg
              : TERMINAL_TOKENS.screenFg
        }
      >
        {line}
      </Text>
    </HStack>
  );
}
