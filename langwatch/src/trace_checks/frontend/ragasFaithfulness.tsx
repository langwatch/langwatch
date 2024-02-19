import { HStack, Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { RagasResult } from "../types";
import numeral from "numeral";

export function RagasFaithfulness({ check }: { check: TraceCheck }) {
  const result = check.raw_result as RagasResult | undefined;
  const faithfulnessScore = result?.scores?.faithfulness;


  const color = check.status === 'succeeded' ? "green.500" : "red.500";

  return (
    <VStack align="start">
      <HStack>
        <Text>Faithfulness Score:</Text> <Text color={color}>{numeral(faithfulnessScore).format("0.00")}</Text>
      </HStack>
    </VStack >
  );
}
