import { HStack, Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { RagasResult } from "../types";
import numeral from "numeral";

export function RagasContextPrecision({ check }: { check: TraceCheck }) {
  const result = check.raw_result as RagasResult | undefined;
  const contextPrecisionScore = result?.scores?.context_precision;

  const color = check.status === 'succeeded' ? "green.500" : "red.500";


  return (
    <VStack align="start">
      <HStack>
        <Text>
          Context Precision Score:

        </Text>
        <Text color={color}> {numeral(contextPrecisionScore).format("0.00")}</Text>

      </HStack>
    </VStack >
  );
}
