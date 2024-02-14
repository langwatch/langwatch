import { Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { RagasResult } from "../types";
import numeral from "numeral";

export function RagasContextPrecision({ check }: { check: TraceCheck }) {
  const result = check.raw_result as RagasResult | undefined;
  const contextPrecisionScore = result?.scores?.context_precision;

  return (
    <VStack align="start">
      <Text>
        Context Precision Score:{" "}
        {numeral(contextPrecisionScore).format("0.00")}
      </Text>
    </VStack>
  );
}
