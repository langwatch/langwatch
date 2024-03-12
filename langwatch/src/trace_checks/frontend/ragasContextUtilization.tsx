import { HStack, Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { RagasResult } from "../types";
import numeral from "numeral";

export function RagasContextUtilization({ check }: { check: TraceCheck }) {
  const result = check.raw_result as RagasResult | undefined;
  const contextUtilizationScore = result?.scores?.context_utilization;

  const color = check.status === 'succeeded' ? "green.500" : "red.500";


  return (
    <VStack align="start">
      <HStack>
        <Text>
          Context Utilization Score:

        </Text>
        <Text color={color}> {numeral(contextUtilizationScore).format("0.00")}</Text>

      </HStack>
    </VStack >
  );
}
