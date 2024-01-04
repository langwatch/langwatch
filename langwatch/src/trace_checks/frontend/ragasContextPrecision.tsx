import { Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { RagasResult, TraceCheckFrontendDefinition } from "../types";

function CheckDetails({ check }: { check: TraceCheck }) {
  const result = check.raw_result as RagasResult;
  const contextPrecisionScore = result.scores.context_precision;

  return (
    <VStack align="start">
      <Text>Context Precision Score: {contextPrecisionScore?.toFixed(2)}</Text>
    </VStack>
  );
}

export const RagasContextPrecision: TraceCheckFrontendDefinition<"ragas_context_precision"> =
  {
    name: "Ragas Context Precision",
    requiresRag: true,
    description:
      "For RAG messages, evaluates the ratio of relevance from the RAG provided contexts to the input",
    parametersDescription: {},
    default: {
      parameters: {},
    },
    render: CheckDetails,
  };
