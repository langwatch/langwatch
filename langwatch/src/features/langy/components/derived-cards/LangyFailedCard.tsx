/**
 * The failed-block disclosure (ADR-060 §8) — a block that could not be
 * salvaged or did not validate, rendered as a collapsed one-line note that
 * expands to the raw fenced text. Never a guessed card, never silent
 * removal: a failure may never be quieter than a success, and the raw text
 * is the reader's evidence of what the model actually wrote.
 */
import { Box, HStack, Text, chakra } from "@chakra-ui/react";
import type { LangyCardFailedPart } from "@langwatch/langy";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { useState } from "react";

export function LangyFailedCard({ part }: { part: LangyCardFailedPart }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Box
      borderWidth="1px"
      borderStyle="dashed"
      borderColor="border.muted"
      borderRadius="langyCard"
      background="bg.subtle"
      paddingX="12px"
      paddingY="8px"
    >
      <chakra.button
        type="button"
        onClick={() => setExpanded((previous) => !previous)}
        display="flex"
        alignItems="center"
        gap={1.5}
        width="full"
        textAlign="left"
        cursor="pointer"
        aria-expanded={expanded}
        color="fg.muted"
      >
        <TriangleAlert size={12} />
        <Text textStyle="xs" flex={1} minWidth={0}>
          Langy tried to draw a card here
        </Text>
        <HStack gap={0.5} textStyle="2xs" color="fg.subtle" flexShrink={0}>
          <Text as="span">{expanded ? "Hide raw" : "View raw"}</Text>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </HStack>
      </chakra.button>
      {expanded ? (
        <Box
          as="pre"
          marginTop={2}
          textStyle="2xs"
          fontFamily="mono"
          color="fg"
          background="bg.muted"
          borderWidth="1px"
          borderStyle="solid"
          borderColor="border.muted"
          borderRadius="sm"
          padding={2}
          maxHeight="200px"
          overflowY="auto"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
        >
          {part.raw}
        </Box>
      ) : null}
    </Box>
  );
}
