import { Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { RagasResult, TraceCheckFrontendDefinition } from "../types";

function CheckDetails({ check }: { check: TraceCheck }) {
  const result = check.raw_result as RagasResult;
  const relevancyScore = result.scores.answer_relevancy;

  return (
    <VStack align="start">
      <Text>Answer Relevancy Score: {relevancyScore?.toFixed(2)}</Text>
    </VStack>
  );
}

export const RagasAnswerRelevancyCheck: TraceCheckFrontendDefinition<"ragas_answer_relevancy"> =
  {
    name: "Ragas Answer Relevancy",
    description: "Evaluates how relevant the answer is to the input",
    parametersDescription: {},
    default: {
      parameters: {},
    },
    render: CheckDetails,
  };
