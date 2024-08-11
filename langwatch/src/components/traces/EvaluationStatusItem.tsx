import {
  Box,
  HStack,
  Text,
  VStack,
  Flex,
  Spacer,
  Tooltip,
} from "@chakra-ui/react";
import type { ElasticSearchEvaluation } from "../../server/tracer/types";
import { getEvaluatorDefinitions } from "../../trace_checks/getEvaluator";
import numeral from "numeral";
import { formatDistanceToNow } from "date-fns";
import type { EvaluatorTypes } from "../../trace_checks/evaluators.generated";
import {
  CheckStatusIcon,
  checkStatusColorMap,
} from "../checks/EvaluationStatus";

export function EvaluationStatusItem({
  check,
}: {
  check: ElasticSearchEvaluation;
}) {
  const checkType = check.check_type as EvaluatorTypes;

  const evaluator = getEvaluatorDefinitions(checkType);

  const color = checkStatusColorMap(check);

  return (
    <Box
      backgroundColor={"gray.100"}
      width={"full"}
      padding={6}
      borderRadius={"lg"}
    >
      <Flex>
        <HStack align="start" spacing={1}>
          <Box paddingRight={2} color={color}>
            <CheckStatusIcon check={check} />
          </Box>
          <VStack alignItems="start" spacing={1}>
            <Text>
              <b>{check.check_name || evaluator?.name}</b>
            </Text>
            {evaluator && <Text fontSize={"sm"}>{evaluator.description}</Text>}
            <Text fontSize={"sm"}>
              {check.status == "processed" ? (
                <VStack align="start" spacing={1}>
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
                          {check.score !== undefined
                            ? numeral(check.score).format("0.[00]")
                            : "N/A"}
                        </Text>
                      </HStack>
                    )}
                  {check.details && (
                    <HStack align="start">
                      <Text>Details:</Text>
                      <Text color={color}>{check.details}</Text>
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
        <Text fontSize={"sm"}>
          {check.timestamps.finished_at && (
            <Tooltip
              label={new Date(check.timestamps.finished_at).toLocaleString()}
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
      </Flex>
    </Box>
  );
}
