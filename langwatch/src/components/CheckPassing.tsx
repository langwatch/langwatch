import { Box, HStack, Text } from "@chakra-ui/react";
import type { ElasticSearchEvaluation } from "../server/tracer/types";
import type { EvaluatorTypes } from "../evaluations/evaluators.generated";
import { getEvaluatorDefinitions } from "../evaluations/getEvaluator";
import {
  CheckStatusIcon,
  evaluationStatusColor,
} from "./checks/EvaluationStatus";
import { formatEvaluationScore } from "./traces/EvaluationStatusItem";

export function CheckPassing({ check }: { check: ElasticSearchEvaluation }) {
  const checkType = check.type as EvaluatorTypes;

  const evaluator = getEvaluatorDefinitions(checkType);

  return (
    <HStack align="start" spacing={2}>
      <Box paddingRight={2} color={evaluationStatusColor(check)}>
        <CheckStatusIcon check={check} />
      </Box>
      <Text whiteSpace="nowrap">
        <b>{check.name || evaluator?.name}:</b>
      </Text>
      {check.status == "processed" ? (
        <Text noOfLines={1} maxWidth="400px">
          {!!evaluator?.isGuardrail ||
          (typeof check.score !== "number" &&
            check.passed !== null &&
            check.passed !== undefined)
            ? check.passed
              ? "Passed"
              : "Failed"
            : "Score: " + formatEvaluationScore(check.score)}
          {check.details ? `. Details: ${check.details}` : ""}
        </Text>
      ) : check.status == "skipped" ? (
        <Text noOfLines={1} maxWidth="400px">
          Skipped{check.details ? `: ${check.details}` : ""}
        </Text>
      ) : check.status == "error" ? (
        <Text noOfLines={1} maxWidth="400px">
          Error: {check.error?.message}
        </Text>
      ) : check.status == "in_progress" ? (
        <Text>Processing</Text>
      ) : check.status === "scheduled" ? (
        <Text>Scheduled</Text>
      ) : (
        <Text>unknown</Text>
      )}
    </HStack>
  );
}
