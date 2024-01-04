import { Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { RagasResult } from "../types";

export function RagasFaithfulness({ check }: { check: TraceCheck }) {
  const result = check.raw_result as RagasResult;
  const faithfulnessScore = result.scores.faithfulness;

  return (
    <VStack align="start">
      <Text>Faithfulness Score: {faithfulnessScore}</Text>
    </VStack>
  );
}
