import { Box, type BoxProps, HStack, Text, VStack } from "@chakra-ui/react";
import { type Change, diffWordsWithSpace } from "diff";
import { useMemo } from "react";

import type { PromptVersionChange } from "./promptVersionDiff";

/** Added words are lifted, removed words are struck, the rest recedes. */
function partTone(part: Change): BoxProps {
  if (part.added) {
    return { background: "green.subtle", color: "green.fg" };
  }
  if (part.removed) {
    return {
      background: "red.subtle",
      color: "red.fg",
      textDecoration: "line-through",
    };
  }
  return { color: "fg.muted" };
}

/**
 * Word-level diff of one text field, following the annotation diff panel:
 * added words sit on `green.subtle`, removed words on `red.subtle` and struck
 * through, everything else recedes to `fg.muted` so the eye lands on the edit.
 */
function TextChange({ before, after }: { before: string; after: string }) {
  const parts = useMemo(
    () => diffWordsWithSpace(before, after),
    [before, after],
  );

  return (
    <Box
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
      background="bg.subtle"
      paddingX={2.5}
      paddingY={2}
      maxHeight="180px"
      overflowY="auto"
      overflowX="hidden"
      fontSize="12px"
      lineHeight="1.6"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
    >
      {/* Diff parts have no identity of their own, so position is the key. */}
      {parts.map((part, index) => (
        <Box
          key={`${index}-${part.value}`}
          as="span"
          borderRadius="2px"
          {...partTone(part)}
        >
          {part.value}
        </Box>
      ))}
    </Box>
  );
}

/** A single setting, read as before then after. */
function ValueChange({ before, after }: { before: string; after: string }) {
  return (
    <HStack gap={2} fontSize="12px" flexWrap="wrap">
      {before && (
        <Text
          color="red.fg"
          background="red.subtle"
          borderRadius="2px"
          paddingX={1}
          textDecoration="line-through"
        >
          {before}
        </Text>
      )}
      {before && after && <Text color="fg.subtle">to</Text>}
      {after && (
        <Text
          color="green.fg"
          background="green.subtle"
          borderRadius="2px"
          paddingX={1}
        >
          {after}
        </Text>
      )}
    </HStack>
  );
}

const STATUS_LABELS = {
  added: "Added",
  removed: "Removed",
  changed: "",
} as const;

function ChangeEntry({ change }: { change: PromptVersionChange }) {
  const statusLabel = STATUS_LABELS[change.status];

  return (
    <VStack align="stretch" gap={1.5} width="full">
      <HStack gap={2}>
        <Text
          fontSize="10px"
          fontWeight={700}
          letterSpacing="0.06em"
          textTransform="uppercase"
          color="fg.muted"
        >
          {change.label}
        </Text>
        {statusLabel && (
          <Text
            fontSize="10px"
            fontWeight={600}
            letterSpacing="0.06em"
            textTransform="uppercase"
            color={change.status === "added" ? "green.fg" : "red.fg"}
          >
            {statusLabel}
          </Text>
        )}
      </HStack>
      {change.kind === "text" ? (
        <TextChange before={change.before} after={change.after} />
      ) : (
        <ValueChange before={change.before} after={change.after} />
      )}
    </VStack>
  );
}

/**
 * Everything one version changed relative to the version before it.
 *
 * An empty list is meaningful rather than an error: republishing an older
 * version as the latest produces a version whose content is identical to its
 * predecessor's, and saying so is more useful than showing nothing.
 */
export function VersionChanges({
  changes,
}: {
  changes: PromptVersionChange[];
}) {
  if (changes.length === 0) {
    return (
      <Text fontSize="12px" color="fg.subtle">
        Nothing changed from the version before this one.
      </Text>
    );
  }

  return (
    <VStack align="stretch" gap={3} width="full">
      {changes.map((change) => (
        <ChangeEntry key={change.key} change={change} />
      ))}
    </VStack>
  );
}
