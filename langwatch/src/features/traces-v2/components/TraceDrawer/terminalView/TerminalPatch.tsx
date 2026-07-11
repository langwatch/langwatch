import { Box, HStack, Text } from "@chakra-ui/react";
import { memo } from "react";
import { TERMINAL_TOKENS } from "./palette";
import type { PatchHunk } from "./toolSpans";

const CELL = {
  fontFamily: "mono",
  fontSize: "12px",
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
          <Text {...CELL} color="green.fg" flexShrink={0}>
            {`+${added}`}
          </Text>
        )}
        {removed > 0 && (
          <Text {...CELL} color="red.fg" flexShrink={0}>
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
                // Only lines present in the new file get a new-file number;
                // a removed line has none, exactly as the CLI shows it.
                lineNumber={newLineNumberAt({ hunk, index: lineIndex })}
              />
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  );
});

/**
 * The new-file line number for a patch line: hunks count from `newStart`, and
 * removed lines don't advance it (they don't exist in the new file).
 */
function newLineNumberAt({
  hunk,
  index,
}: {
  hunk: PatchHunk;
  index: number;
}): number | null {
  const line = hunk.lines[index];
  if (line?.startsWith("-")) return null;

  let n = hunk.newStart;
  for (let i = 0; i < index; i++) {
    if (!hunk.lines[i]?.startsWith("-")) n++;
  }
  return n;
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
    <HStack gap={2} align="flex-start" width="max-content" minWidth="full">
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
        paddingX={1}
        bg={isAdd ? "green.subtle" : isRemove ? "red.subtle" : undefined}
        color={
          isAdd ? "green.fg" : isRemove ? "red.fg" : TERMINAL_TOKENS.screenFg
        }
      >
        {line}
      </Text>
    </HStack>
  );
}
