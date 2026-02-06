import {
  Box,
  Circle,
  HStack,
  IconButton,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { formatDistanceToNow } from "date-fns";
import { MoreVertical, Pencil } from "lucide-react";
import { useRouter } from "next/router";
import numeral from "numeral";
import { useMemo } from "react";
import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";
import { api } from "~/utils/api";
import { useDrawer } from "../../hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { getEvaluatorDefinitions } from "../../server/evaluations/getEvaluator";
import type { ElasticSearchEvaluation } from "../../server/tracer/types";
import {
  evaluationPassed,
  evaluationStatusColor,
} from "../checks/EvaluationStatus";
import { HoverableBigText } from "../HoverableBigText";
import { Menu } from "../ui/menu";
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

function EvaluatorInputsTooltip({
  inputs,
  children,
}: {
  inputs?: Record<string, any> | null;
  children: React.ReactNode;
}) {
  if (inputs === undefined || inputs === null || Object.keys(inputs).length === 0) {
    return <>{children}</>;
  }

  return (
    <Tooltip
      content={
        <VStack align="start" gap={1} maxWidth="400px">
          <Text fontWeight="semibold" fontSize="xs">
            Evaluator Inputs
          </Text>
          <Box
            fontSize="xs"
            fontFamily="mono"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            maxHeight="300px"
            overflow="auto"
          >
            {JSON.stringify(inputs, null, 2)}
          </Box>
        </VStack>
      }
    >
      {children}
    </Tooltip>
  );
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

  const isEvaluatorTable = check.evaluator_id?.startsWith("evaluator_");

  const evaluatorQuery = api.evaluators.getById.useQuery(
    { id: check.evaluator_id ?? "", projectId: project?.id ?? "" },
    {
      enabled: !!isEvaluatorTable && !!check.evaluator_id && !!project?.id,
      staleTime: 5 * 60 * 1000,
    },
  );

  const monitorQuery = api.monitors.getById.useQuery(
    { id: check.evaluator_id ?? "", projectId: project?.id ?? "" },
    {
      enabled: !isEvaluatorTable && !!check.evaluator_id && !!project?.id,
      staleTime: 5 * 60 * 1000,
    },
  );

  const color = evaluationStatusColor(check);
  const passed = evaluationPassed(check);

  const customPrompt = useMemo(() => {
    if (isEvaluatorTable && evaluatorQuery.data) {
      const config = evaluatorQuery.data.config as
        | { settings?: { prompt?: string } }
        | undefined;
      return config?.settings?.prompt;
    }
    if (!isEvaluatorTable && monitorQuery.data) {
      const config = monitorQuery.data.evaluator?.config as
        | { settings?: { prompt?: string } }
        | undefined;
      return config?.settings?.prompt;
    }
    return undefined;
  }, [isEvaluatorTable, evaluatorQuery.data, monitorQuery.data]);

  const hasEvaluatorData = isEvaluatorTable
    ? !!evaluatorQuery.data
    : !!monitorQuery.data;

  const handleOpenConfig = () => {
    if (!check.evaluator_id) return;

    if (isEvaluatorTable) {
      openDrawer("evaluatorEditor", { evaluatorId: check.evaluator_id });
    } else {
      openDrawer("onlineEvaluation", { monitorId: check.evaluator_id });
    }
  };

  const hasDetails = check.status === "processed" && check.details;

  return (
    <Box width="full">
      {/* Header row: status dot + name + badges + time + menu */}
      <HStack align="center" gap={3} width="full">
        {/* Status indicator + evaluator name with inputs tooltip */}
        <EvaluatorInputsTooltip inputs={check.inputs}>
          <HStack gap={3} minWidth={0}>
            {check.status === "in_progress" || check.status === "scheduled" ? (
              <Spinner size="xs" color={color} />
            ) : (
              <Circle size="10px" bg={color} flexShrink={0} />
            )}

            <VStack align="start" gap={0} minWidth={0}>
              <Text fontWeight="semibold" fontSize="sm" lineClamp={1}>
                {check.name || evaluator?.name}
              </Text>
              {customPrompt ? (
                <Text fontSize="xs" color="fg.subtle" lineClamp={1}>
                  <HoverableBigText
                    expandedVersion={customPrompt}
                    lineClamp={1}
                  >
                    <Box as="span" whiteSpace="pre-wrap" wordBreak="break-word">
                      {customPrompt}
                    </Box>
                  </HoverableBigText>
                </Text>
              ) : evaluator?.description ? (
                <Text fontSize="xs" color="fg.subtle" lineClamp={1}>
                  {evaluator.description}
                </Text>
              ) : null}
            </VStack>
          </HStack>
        </EvaluatorInputsTooltip>

        <Spacer />

        {/* Result badges */}
        <HStack gap={2} flexShrink={0}>
          {check.status === "processed" && (
            <>
              {/* Score badge */}
              {!evaluator?.isGuardrail &&
                check.score !== undefined &&
                check.score !== null && (
                  <Box
                    bg="bg.muted"
                    paddingX={2}
                    paddingY={0.5}
                    borderRadius="md"
                    fontSize="sm"
                    fontWeight="semibold"
                    fontFamily="mono"
                  >
                    {formatEvaluationScore(check.score)}
                  </Box>
                )}

              {/* Pass/Fail badge */}
              {passed !== undefined && (
                <Box
                  bg={passed ? "green.subtle" : "red.subtle"}
                  color={passed ? "green.fg" : "red.fg"}
                  paddingX={2}
                  paddingY={0.5}
                  borderRadius="md"
                  fontSize="xs"
                  fontWeight="semibold"
                >
                  {passed ? "Pass" : "Fail"}
                </Box>
              )}

              {/* Label badge */}
              {check.label && (
                <Box
                  bg="blue.subtle"
                  color="blue.fg"
                  paddingX={2}
                  paddingY={0.5}
                  borderRadius="md"
                  fontSize="xs"
                  fontWeight="semibold"
                >
                  {check.label}
                </Box>
              )}
            </>
          )}

          {/* Error badge */}
          {check.status === "error" && (
            <Box
              bg="red.subtle"
              color="red.fg"
              paddingX={2}
              paddingY={0.5}
              borderRadius="md"
              fontSize="xs"
              fontWeight="semibold"
            >
              Error
            </Box>
          )}

          {/* Skipped badge */}
          {check.status === "skipped" && (
            <Box
              bg="yellow.subtle"
              color="yellow.fg"
              paddingX={2}
              paddingY={0.5}
              borderRadius="md"
              fontSize="xs"
              fontWeight="semibold"
            >
              Skipped
            </Box>
          )}

          {/* Processing/Scheduled badge */}
          {(check.status === "in_progress" ||
            check.status === "scheduled") && (
            <Text fontSize="xs" color="fg.subtle">
              {check.status === "in_progress" ? "Processing..." : "Scheduled"}
            </Text>
          )}
        </HStack>

        {/* Timestamp */}
        {check.timestamps.finished_at && (
          <Tooltip
            content={new Date(check.timestamps.finished_at).toLocaleString()}
          >
            <Text
              fontSize="xs"
              color="fg.subtle"
              flexShrink={0}
              borderBottomWidth="1px"
              borderBottomColor="border.emphasized"
              borderBottomStyle="dashed"
            >
              {formatDistanceToNow(new Date(check.timestamps.finished_at), {
                addSuffix: true,
              })}
            </Text>
          </Tooltip>
        )}

        {/* Three-dot menu */}
        {projectSlug && check.evaluator_id && hasEvaluatorData && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <IconButton
                variant="ghost"
                size="xs"
                aria-label="Evaluation options"
                flexShrink={0}
              >
                <MoreVertical size={14} />
              </IconButton>
            </Menu.Trigger>
            <Menu.Content minWidth="160px" zIndex="popover">
              <Menu.Item value="edit" onClick={handleOpenConfig}>
                <HStack gap={2}>
                  <Pencil size={14} />
                  <Text>Edit Configuration</Text>
                </HStack>
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        )}
      </HStack>

      {/* Details/reasoning section */}
      {hasDetails && (
        <Box paddingLeft="22px" marginTop={2}>
          <Box
            borderTopWidth="1px"
            borderTopStyle="dashed"
            borderTopColor="border.subtle"
            paddingTop={2}
          >
            <Text fontSize="sm" color="fg.subtle">
              <HoverableBigText
                expandedVersion={check.details!}
                lineClamp={3}
              >
                <Box as="span" whiteSpace="pre-wrap" wordBreak="break-word">
                  {check.details}
                </Box>
              </HoverableBigText>
            </Text>
          </Box>
        </Box>
      )}

      {/* Error message */}
      {check.status === "error" && check.error?.message && (
        <Box paddingLeft="22px" marginTop={2}>
          <Box
            borderTopWidth="1px"
            borderTopStyle="dashed"
            borderTopColor="border.subtle"
            paddingTop={2}
          >
            <Text fontSize="sm" color="red.fg">
              <HoverableBigText
                expandedVersion={check.error.message}
                lineClamp={3}
              >
                <Box as="span" whiteSpace="pre-wrap" wordBreak="break-word">
                  {check.error.message}
                </Box>
              </HoverableBigText>
            </Text>
          </Box>
        </Box>
      )}

      {/* Skipped details */}
      {check.status === "skipped" && check.details && (
        <Box paddingLeft="22px" marginTop={2}>
          <Box
            borderTopWidth="1px"
            borderTopStyle="dashed"
            borderTopColor="border.subtle"
            paddingTop={2}
          >
            <Text fontSize="sm" color="fg.subtle" whiteSpace="pre-wrap">
              {check.details}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
