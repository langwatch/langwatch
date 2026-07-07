/**
 * BatchPairwiseWinnerCell - Renders the per-row pairwise verdict in the
 * batch results table's dedicated "Winner" column (#5100 follow-up).
 *
 * Each cell shows "Winner: <name>" (or "Tie") plus a short preview of the
 * judge's reasoning; the full reasoning is available on hover so the row
 * height stays predictable. When a row has no verdict for this evaluator
 * (skipped / error / not-yet-run), we render a subtle dash so the column
 * width is preserved and the table doesn't reflow between reruns.
 */

import { Badge, Box, HStack, Text, VStack } from "@chakra-ui/react";

import { Tooltip } from "~/components/ui/tooltip";

import type { BatchPairwiseColumn, BatchPairwiseVerdict } from "./types";

const REASONING_PREVIEW_CHARS = 80;

const truncateForPreview = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length <= REASONING_PREVIEW_CHARS) return trimmed;
  return `${trimmed.slice(0, REASONING_PREVIEW_CHARS).trimEnd()}…`;
};

type WinnerVisual = {
  label: string;
  colorPalette: "green" | "purple" | "gray";
};

const resolveWinner = (
  column: BatchPairwiseColumn,
  verdict: BatchPairwiseVerdict,
): WinnerVisual => {
  if (verdict.label === "tie") {
    return { label: "Tie", colorPalette: "gray" };
  }
  const name =
    verdict.label === "A" ? column.variantAName : column.variantBName;
  // A green-vs-purple split (rather than green-vs-red) so both winners read
  // as "the picked one" — a red side would code as failure, which the loser
  // in a pairwise run isn't. Matches the RowVerdictStrip palette in
  // experiments-v3.
  return {
    label: name,
    colorPalette: verdict.label === "A" ? "green" : "purple",
  };
};

export function BatchPairwiseWinnerCell({
  column,
  verdict,
}: {
  column: BatchPairwiseColumn;
  verdict: BatchPairwiseVerdict | undefined;
}) {
  if (!verdict) {
    return (
      <Text fontSize="13px" color="fg.subtle" data-testid="pairwise-winner-none">
        -
      </Text>
    );
  }

  const winner = resolveWinner(column, verdict);
  const reasoning = verdict.reasoning?.trim();
  const preview = reasoning ? truncateForPreview(reasoning) : null;
  const hasOverflow = !!reasoning && reasoning.length > REASONING_PREVIEW_CHARS;

  const badge = (
    <Badge
      colorPalette={winner.colorPalette}
      size="sm"
      variant="subtle"
      data-testid={`pairwise-winner-badge-${verdict.label}`}
    >
      {verdict.label === "tie" ? "Tie" : `Winner: ${winner.label}`}
    </Badge>
  );

  return (
    <VStack align="start" gap={1}>
      <HStack gap={1.5}>{badge}</HStack>
      {preview && (
        <Tooltip
          content={
            <Text
              fontSize="12px"
              whiteSpace="pre-wrap"
              wordBreak="break-word"
              maxWidth="480px"
            >
              {reasoning}
            </Text>
          }
          positioning={{ placement: "top" }}
          openDelay={hasOverflow ? 100 : 400}
          disabled={!hasOverflow}
        >
          <Box>
            <Text
              fontSize="12px"
              color="fg.muted"
              cursor={hasOverflow ? "help" : "default"}
              data-testid="pairwise-winner-reasoning"
            >
              {preview}
            </Text>
          </Box>
        </Tooltip>
      )}
    </VStack>
  );
}
