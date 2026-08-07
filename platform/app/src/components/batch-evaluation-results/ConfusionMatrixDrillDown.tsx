/**
 * The rows behind one matrix cell.
 *
 * This is the payoff of the whole chart: a False Positive count says the
 * judge was wrong six times, and only this list says what it got wrong and
 * and, when the reviewer wrote one, why.
 */
import { Box, Text, VStack } from "@chakra-ui/react";

import { formatTargetOutput } from "~/utils/formatTargetOutput";
import { QUADRANT_LABELS, type Quadrant } from "./ConfusionMatrixGrid";
import type { JudgeAnnotationPair } from "./computeConfusionMatrix";
import type { BatchResultRow } from "./types";

export function ConfusionMatrixDrillDown({
  quadrant,
  pairs,
  rowsByIndex,
  targetId,
}: {
  quadrant: Quadrant;
  pairs: JudgeAnnotationPair[];
  rowsByIndex: Map<number, BatchResultRow>;
  targetId: string;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
    >
      <Text fontWeight="semibold" fontSize="sm" marginBottom={2}>
        {QUADRANT_LABELS[quadrant]} ({pairs.length} row
        {pairs.length === 1 ? "" : "s"})
      </Text>
      {pairs.length === 0 ? (
        <Text fontSize="xs" color="fg.muted">
          No rows in this cell.
        </Text>
      ) : (
        <VStack align="stretch" gap={2}>
          {pairs.map((pair) => (
            <DrillDownRow
              key={pair.rowIndex}
              pair={pair}
              row={rowsByIndex.get(pair.rowIndex)}
              targetId={targetId}
            />
          ))}
        </VStack>
      )}
    </Box>
  );
}

function DrillDownRow({
  pair,
  row,
  targetId,
}: {
  pair: JudgeAnnotationPair;
  row: BatchResultRow | undefined;
  targetId: string;
}) {
  // Same formatter the results table uses, so a row reads identically here
  // and there: it unwraps the common single-"output"-key envelope instead
  // of dumping raw JSON with escaped newlines at the reader.
  const outputText =
    formatTargetOutput(row?.targets[targetId]?.output) || "(no output)";

  return (
    <Box>
      <Text fontSize="xs" color="fg.muted">
        Row {pair.rowIndex + 1}
      </Text>
      <Text fontSize="sm" lineClamp={3}>
        {outputText}
      </Text>
      {/* On a disagreement cell this is the whole point of drilling in: the
          reviewer already wrote down why the judge was wrong. */}
      {pair.comment ? (
        <Text
          fontSize="xs"
          color="fg.muted"
          marginTop={1}
          borderInlineStartWidth="2px"
          borderColor="border.emphasized"
          paddingInlineStart={2}
        >
          Reviewer: {pair.comment}
        </Text>
      ) : null}
    </Box>
  );
}
