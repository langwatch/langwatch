import { Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { TraceCheckFrontendDefinition } from "../types";
import type { InconsistencyCheckResult } from "../types";

function CheckDetails({ check }: { check: TraceCheck }) {
  const inconsistencyResult = check.raw_result as InconsistencyCheckResult;
  const sentences = inconsistencyResult.sentences;

  return (
    <VStack align="start">
      {sentences.length > 0 ? (
        sentences.map((sentence, index) => (
          <Text key={index}>Inconsistency detected: {sentence}</Text>
        ))
      ) : (
        <Text>No inconsistencies detected</Text>
      )}
    </VStack>
  );
}

export const InconsistencyCheck: TraceCheckFrontendDefinition<"inconsistency_check"> =
  {
    name: "(Beta) Inconsistency Detection",
    description:
      "Detects inconsistencies between input and output text for hallucination prevention",
    parametersDescription: {},
    default: {
      parameters: {},
    },
    render: CheckDetails,
  };
