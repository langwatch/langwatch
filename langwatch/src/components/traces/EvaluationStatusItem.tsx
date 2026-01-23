import { Box, HStack, Link, Spacer, Text, VStack } from "@chakra-ui/react";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink } from "lucide-react";
import { useRouter } from "next/router";
import numeral from "numeral";
import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";
import { api } from "~/utils/api";
import { useDrawer } from "../../hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { getEvaluatorDefinitions } from "../../server/evaluations/getEvaluator";
import type { ElasticSearchEvaluation } from "../../server/tracer/types";
import {
  CheckStatusIcon,
  evaluationStatusColor,
} from "../checks/EvaluationStatus";
import { HoverableBigText } from "../HoverableBigText";
import { Tooltip } from "../ui/tooltip";
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
  const router = useRouter();
  const projectSlug = router.query.project as string | undefined;
  const { openDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();
  const checkType = check.type as EvaluatorTypes;

  const evaluator = getEvaluatorDefinitions(checkType);

  // Fetch monitor data to get evaluator config with prompt
  const monitorQuery = api.monitors.getById.useQuery(
    { id: check.evaluator_id, projectId: project?.id ?? "" },
    {
      enabled: !!check.evaluator_id && !!project?.id,
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    },
  );

  const color = evaluationStatusColor(check);

  // Get the prompt from evaluator config if available
  const evaluatorConfig = monitorQuery.data?.evaluator?.config as
    | {
        settings?: { prompt?: string };
      }
    | undefined;
  const customPrompt = evaluatorConfig?.settings?.prompt;

  const handleOpenMonitorConfig = () => {
    if (check.evaluator_id) {
      openDrawer("onlineEvaluation", { monitorId: check.evaluator_id });
    }
  };

  return (
    <Box
      backgroundColor="bg.muted"
      width={"full"}
      padding={6}
      borderRadius={"lg"}
    >
      <HStack align="start" gap={1} width="full">
        <Box paddingRight={2} color={color}>
          <CheckStatusIcon check={check} />
        </Box>
        <VStack alignItems="start" gap={1} width="full">
          <HStack align="start" width="full" gap={2}>
            <Text>
              <b>{check.name || evaluator?.name}</b>
            </Text>
            <Spacer />
            {projectSlug && check.evaluator_id && (
              <Link
                fontSize="sm"
                color="blue.500"
                onClick={handleOpenMonitorConfig}
                cursor="pointer"
                display="flex"
                alignItems="center"
                gap={1}
              >
                <ExternalLink size={12} />
                Configure
              </Link>
            )}
            <Text color="fg.subtle">·</Text>
            <Text fontSize={"sm"}>
              {check.timestamps.finished_at && (
                <Tooltip
                  content={new Date(
                    check.timestamps.finished_at,
                  ).toLocaleString()}
                >
                  <Text
                    borderBottomWidth="1px"
                    borderBottomColor="border.emphasized"
                    borderBottomStyle="dashed"
                  >
                    {formatDistanceToNow(
                      new Date(check.timestamps.finished_at),
                      {
                        addSuffix: true,
                      },
                    )}
                  </Text>
                </Tooltip>
              )}
            </Text>
          </HStack>
          {/* Show default evaluator description when no custom prompt */}
          {!customPrompt && evaluator?.description && (
            <Text fontSize={"sm"} color="fg.subtle">
              {evaluator.description}
            </Text>
          )}
          <Text fontSize={"sm"}>
            {check.status == "processed" ? (
              <VStack align="start" gap={1}>
                {customPrompt && (
                  <HStack align="start">
                    <Text>Prompt:</Text>
                    <Text color="fg.subtle">
                      <HoverableBigText
                        expandedVersion={customPrompt}
                        cursor="pointer"
                        lineClamp={4}
                      >
                        <pre
                          style={{
                            whiteSpace: "pre-wrap",
                            wordWrap: "break-word",
                          }}
                        >
                          {customPrompt}
                        </pre>
                      </HoverableBigText>
                    </Text>
                  </HStack>
                )}
                {check.passed !== undefined && check.passed !== null && (
                  <HStack>
                    <Text>Result:</Text>
                    <Text color={color}>{check.passed ? "Pass" : "Fail"}</Text>
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
    </Box>
  );
}
