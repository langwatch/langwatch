import { Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { RagasResult, TraceCheckFrontendDefinition } from "../types";

function CheckDetails({ check }: { check: TraceCheck }) {
  const result = check.raw_result as RagasResult;
  const faithfulnessScore = result.scores.faithfulness;

  return (
    <VStack align="start">
      <Text>Faithfulness Score: {faithfulnessScore}</Text>
    </VStack>
  );
}

export const RagasFaithfulness: TraceCheckFrontendDefinition<"ragas_faithfulness"> = {
  name: "Ragas Faithfulness",
  requiresRag: true,
  description:
    "For RAG messages, evaluates the factual consistency of the generated answer against the RAG provided context",
  parametersDescription: {},
  default: {
    parameters: {},
  },
  render: CheckDetails,
};
