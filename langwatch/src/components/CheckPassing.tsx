import { Box, HStack, Text } from "@chakra-ui/react";
import type { ElasticSearchEvaluation } from "../server/tracer/types";
import { getEvaluatorDefinitions } from "../trace_checks/getEvaluator";
import type { EvaluatorTypes } from "../trace_checks/evaluators.generated";
import {
  CheckStatusIcon,
  checkStatusColorMap,
} from "./checks/EvaluationStatus";
import numeral from "numeral";

export function CheckPassing({ check }: { check: ElasticSearchEvaluation }) {
  const checkType = check.type as EvaluatorTypes;

  const evaluator = getEvaluatorDefinitions(checkType);
  if (!evaluator) return null;

  return (
    <HStack align="start" spacing={2}>
      <Box paddingRight={2} color={checkStatusColorMap(check)}>
        <CheckStatusIcon check={check} />
      </Box>
      <Text whiteSpace="nowrap">
        <b>{check.name || evaluator.name}:</b>
      </Text>
      {check.status == "processed" ? (
        <Text noOfLines={1} maxWidth="400px">
          {evaluator.isGuardrail
            ? check.passed
              ? "Passed"
              : "Failed"
            : "Score: " +
              (check.score !== undefined ? numeral(check.score).format("0.[00]") : "N/A")}
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
