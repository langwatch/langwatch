import { Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { RagasResult } from "../types";
import { toFixedWithoutRounding } from "../../utils/toFixedWithoutRounding";

export function RagasContextPrecision({ check }: { check: TraceCheck }) {
  const result = check.raw_result as RagasResult | undefined;
  const contextPrecisionScore = result?.scores?.context_precision;

  return (
    <VStack align="start">
      <Text>
        Context Precision Score:{" "}
        {toFixedWithoutRounding(contextPrecisionScore, 2)}
      </Text>
    </VStack>
  );
}
