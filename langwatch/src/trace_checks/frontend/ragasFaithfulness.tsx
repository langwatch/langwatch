import { Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { RagasResult } from "../types";
import numeral from "numeral";

export function RagasFaithfulness({ check }: { check: TraceCheck }) {
  const result = check.raw_result as RagasResult | undefined;
  const faithfulnessScore = result?.scores?.faithfulness;

  return (
    <VStack align="start">
      <Text>Faithfulness Score: {numeral(faithfulnessScore).format("0.00")}</Text>
    </VStack>
  );
}
