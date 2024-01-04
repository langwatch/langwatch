import { Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { RagasResult } from "../types";

export function RagasAnswerRelevancy({ check }: { check: TraceCheck }) {
  const result = check.raw_result as RagasResult;
  const relevancyScore = result.scores.answer_relevancy;

  return (
    <VStack align="start">
      <Text>Answer Relevancy Score: {relevancyScore?.toFixed(2)}</Text>
    </VStack>
  );
}
