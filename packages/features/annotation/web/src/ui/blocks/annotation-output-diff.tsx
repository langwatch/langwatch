import { Box, HStack, Text } from "@chakra-ui/react";
import { type Change, diffWordsWithSpace } from "diff";
import { useDeferredValue, useMemo } from "react";

/**
 * The word-level difference between the captured output and the reviewer's
 * correction, computed once for everything that reads it. The diff is the
 * expensive call in the suggest form and the field it reads is a whole trace
 * output, so the counts and the panel share one pass.
 *
 * `useDeferredValue` keeps typing snappy by recomputing at idle.
 */
export function useOutputDiff({
  original,
  edited,
}: {
  original: string;
  edited: string;
}): Change[] {
  const deferredEdited = useDeferredValue(edited);
  return useMemo(() => diffWordsWithSpace(original, deferredEdited), [original, deferredEdited]);
}

/** How much the correction added and removed, in characters. */
export function DiffCounts({ parts }: { parts: Change[] }) {
  const counts = useMemo(() => {
    const added = parts.filter((p) => p.added).reduce((acc, p) => acc + p.value.length, 0);
    const removed = parts.filter((p) => p.removed).reduce((acc, p) => acc + p.value.length, 0);
    return { added, removed };
  }, [parts]);

  if (counts.added === 0 && counts.removed === 0) {
    return (
      <Text textStyle="2xs" color="fg.subtle">
        no changes
      </Text>
    );
  }

  return (
    <HStack gap={2}>
      <Text textStyle="2xs" color="green.fg">
        +{counts.added}
      </Text>
      <Text textStyle="2xs" color="red.fg">
        −{counts.removed}
      </Text>
    </HStack>
  );
}

/**
 * Read-only word-level diff. Fixed height with internal scroll: the
 * panel size is locked so the popover doesn't resize as the user types.
 */
export function DiffPanel({ parts }: { parts: Change[] }) {
  const hasChanges = parts.some((p) => p.added || p.removed);

  return (
    <Box
      height="160px"
      minHeight="160px"
      maxHeight="160px"
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.subtle"
      paddingX={3}
      paddingY={2.5}
      overflowY="auto"
      overflowX="hidden"
      fontSize="xs"
      lineHeight="1.6"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
    >
      {hasChanges ? (
        parts.map((part, i) => {
          if (part.added) {
            return (
              <Box key={i} as="span" bg="green.subtle" color="green.fg" borderRadius="2px">
                {part.value}
              </Box>
            );
          }
          if (part.removed) {
            return (
              <Box
                key={i}
                as="span"
                bg="red.subtle"
                color="red.fg"
                textDecoration="line-through"
                borderRadius="2px"
              >
                {part.value}
              </Box>
            );
          }
          return (
            <Box key={i} as="span" color="fg.muted">
              {part.value}
            </Box>
          );
        })
      ) : (
        <Text textStyle="xs" color="fg.subtle" fontStyle="italic">
          Edit the field above to see what changed.
        </Text>
      )}
    </Box>
  );
}
