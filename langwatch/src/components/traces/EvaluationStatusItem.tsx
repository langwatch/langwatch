import { Box, HStack, Text, VStack, Spacer } from "@chakra-ui/react";
import type { ElasticSearchEvaluation } from "../../server/tracer/types";
import { getEvaluatorDefinitions } from "../../server/evaluations/getEvaluator";
import numeral from "numeral";
import { formatDistanceToNow } from "date-fns";
import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";
import {
  CheckStatusIcon,
  evaluationStatusColor,
} from "../checks/EvaluationStatus";
import { Tooltip } from "../ui/tooltip";
import { HoverableBigText } from "../HoverableBigText";
export function formatEvaluationSingleValue(evaluation: {
  score?: number | null;
  passed?: boolean | null;
  label?: string | null;
}) {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return evaluation.label !== undefined && evaluation.label !== null
    ? evaluation.label
    : evaluation.score !== undefined && evaluation.score !== null
    ? formatEvaluationScore(evaluation.score)
    : evaluation.passed !== undefined && evaluation.passed !== null
    ? evaluation.passed
      ? "Pass"
      : "Fail"
    : "N/A";
}

export function formatEvaluationScore(score: number | null | undefined) {
  if (score === null || score === undefined) {
    return "N/A";
  }
  return numeral(score).format("0.[00]");
}

export function EvaluationStatusItem({
  check,
}: {
  check: ElasticSearchEvaluation;
}) {
  const checkType = check.type as EvaluatorTypes;

  const evaluator = getEvaluatorDefinitions(checkType);

  const color = evaluationStatusColor(check);

  return (
    <Box
      backgroundColor={"gray.100"}
      width={"full"}
      padding={6}
      borderRadius={"lg"}
    >
      <HStack align="start" gap={2}>
        <HStack align="start" gap={1}>
          <Box paddingRight={2} color={color}>
            <CheckStatusIcon check={check} />
          </Box>
          <VStack alignItems="start" gap={1}>
            <Text>
              <b>{check.name || evaluator?.name}</b>
            </Text>
            {evaluator && <Text fontSize={"sm"}>{evaluator.description}</Text>}
            <Text fontSize={"sm"}>
              {check.status == "processed" ? (
                <VStack align="start" gap={1}>
                  {check.passed !== undefined && check.passed !== null && (
                    <HStack>
                      <Text>Result:</Text>
                      <Text color={color}>
                        {check.passed ? "Pass" : "Fail"}
                      </Text>
                    </HStack>
                  )}
                  {!evaluator?.isGuardrail &&
                    check.score !== undefined &&
                    check.score !== null && (
                      <HStack>
                        <Text>Score:</Text>
                        <Text color={color}>
                          {formatEvaluationScore(check.score)}
                        </Text>
                      </HStack>
                    )}
                  {check.label && (
                    <HStack align="start">
                      <Text>Label:</Text>
                      <Text color={color}>{check.label}</Text>
                    </HStack>
                  )}
                  {check.details && (
                    <HStack align="start">
                      <Text>Details:</Text>
                      <Text color={color}>
                        <HoverableBigText
                          expandedVersion={check.details}
                          cursor="pointer"
                        >
                          <pre
                            style={{
                              whiteSpace: "pre-wrap",
                              wordWrap: "break-word",
                            }}
                          >
                            {check.details}
                          </pre>
                        </HoverableBigText>
                      </Text>
                    </HStack>
                  )}
                </VStack>
              ) : check.status == "skipped" ? (
                <HStack>
                  <Text>Skipped{check.details && ": "}</Text>
                  {check.details && <Text color={color}>{check.details}</Text>}
                </HStack>
              ) : check.status == "error" ? (
                <HStack>
                  <Text>Error:</Text>
                  <Text as="span" color={color}>
                    {check.error?.message}
                  </Text>
                </HStack>
              ) : check.status == "in_progress" ? (
                <Text color={color}>Processing</Text>
              ) : check.status === "scheduled" ? (
                <Text color={color}>Scheduled</Text>
              ) : (
                <Text>unknown</Text>
              )}
            </Text>
          </VStack>
        </HStack>
        <Spacer />
        <Text fontSize={"sm"} color="gray.400">
          {check.evaluator_id}
        </Text>
        <Text color="gray.400">·</Text>
        <Text fontSize={"sm"}>
          {check.timestamps.finished_at && (
            <Tooltip
              content={new Date(check.timestamps.finished_at).toLocaleString()}
            >
              <Text
                borderBottomWidth="1px"
                borderBottomColor="gray.400"
                borderBottomStyle="dashed"
              >
                {formatDistanceToNow(new Date(check.timestamps.finished_at), {
                  addSuffix: true,
                })}
              </Text>
            </Tooltip>
          )}
        </Text>
      </HStack>
    </Box>
  );
}
