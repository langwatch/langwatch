import { Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { RagasResult } from "../types";
import numeral from "numeral";

export function RagasAnswerRelevancy({ check }: { check: TraceCheck }) {
  const result = check.raw_result as RagasResult;
  const relevancyScore = result.scores.answer_relevancy;

  return (
    <VStack align="start">
      <Text>
        Answer Relevancy Score: {numeral(relevancyScore).format("0.00")}
      </Text>
    </VStack>
  );
}
