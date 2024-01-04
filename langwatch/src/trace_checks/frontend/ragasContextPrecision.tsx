import { Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { RagasResult } from "../types";

export function RagasContextPrecision({ check }: { check: TraceCheck }) {
  const result = check.raw_result as RagasResult;
  const contextPrecisionScore = result.scores.context_precision;

  return (
    <VStack align="start">
      <Text>Context Precision Score: {contextPrecisionScore?.toFixed(2)}</Text>
    </VStack>
  );
}