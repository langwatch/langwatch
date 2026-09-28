import { Box, Circle, HStack, IconButton, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { useRouter } from "@langwatch/browser-host/use-router";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { evaluationPassed, evaluationStatusColor } from "@langwatch/evaluator-browser-kit";
import type { EvaluatorTypes } from "@langwatch/evaluator-contract";
import { findEvaluatorDefinitions } from "@langwatch/evaluator-contract";
import { formatDistanceToNow } from "@langwatch/time";
import { readableDate } from "@langwatch/trace-browser-kit";
import type { ElasticSearchEvaluation } from "@langwatch/trace-contract";
import { MoreVertical, Pencil } from "lucide-react";
import numeral from "numeral";
import { useMemo } from "react";

import { api } from "../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { HoverableBigText } from "../hoverable-big-text.tsx";

export function formatEvaluationSingleValue(evaluation: {
  score?: number | null;
  passed?: boolean | null;
  label?: string | null;
}) {
  if (evaluation.label !== undefined && evaluation.label !== null) return evaluation.label;
  if (evaluation.score !== undefined && evaluation.score !== null) {
    return formatEvaluationScore(evaluation.score);
  }
  if (evaluation.passed === undefined || evaluation.passed === null) return "N/A";
  return evaluation.passed ? "Pass" : "Fail";
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
  inputs?: Record<string, unknown> | null;
  children: React.ReactNode;
}) {
  if (inputs === undefined || inputs === null || Object.keys(inputs).length === 0) {
    return <>{children}</>;
  }

  return (
    <Tooltip
      interactive
      closeDelay={100}
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

/** The custom prompt an evaluator's settings carry, if any. */
function promptSettingOf(config: unknown): string | undefined {
  if (!config || typeof config !== "object" || !("settings" in config)) return undefined;
  const settings = config.settings;
  if (!settings || typeof settings !== "object" || !("prompt" in settings)) return undefined;
  return typeof settings.prompt === "string" ? settings.prompt : undefined;
}

function Badge({
  bg,
  color,
  mono = false,
  children,
}: {
  bg: string;
  color?: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box
      bg={bg}
      color={color}
      paddingX={2}
      paddingY={0.5}
      borderRadius="md"
      fontSize={mono ? "sm" : "xs"}
      fontWeight="semibold"
      fontFamily={mono ? "mono" : undefined}
    >
      {children}
    </Box>
  );
}

/** Score, pass/fail and label once processed; otherwise the state the run is in. */
function ResultBadges({
  check,
  isGuardrail,
  passed,
}: {
  check: ElasticSearchEvaluation;
  isGuardrail: boolean;
  passed: boolean | undefined;
}) {
  const isPending = check.status === "in_progress" || check.status === "scheduled";
  return (
    <HStack gap={2} flexShrink={0}>
      {check.status === "processed" && (
        <>
          {!isGuardrail && check.score != null && (
            <Badge bg="bg.muted" mono>
              {formatEvaluationScore(check.score)}
            </Badge>
          )}
          {passed !== undefined && (
            <Badge
              bg={passed ? "green.subtle" : "red.subtle"}
              color={passed ? "green.fg" : "red.fg"}
            >
              {passed ? "Pass" : "Fail"}
            </Badge>
          )}
          {check.label && (
            <Badge bg="blue.subtle" color="blue.fg">
              {check.label}
            </Badge>
          )}
        </>
      )}
      {check.status === "error" && (
        <Badge bg="red.subtle" color="red.fg">
          Error
        </Badge>
      )}
      {check.status === "skipped" && (
        <Badge bg="yellow.subtle" color="yellow.fg">
          Skipped
        </Badge>
      )}
      {isPending && (
        <Text fontSize="xs" color="fg.subtle">
          {check.status === "in_progress" ? "Processing..." : "Scheduled"}
        </Text>
      )}
    </HStack>
  );
}

/** A note under the header, ruled off and indented to the name. */
function DetailNote({
  color,
  preWrap = false,
  children,
}: {
  color: string;
  preWrap?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box paddingLeft="22px" marginTop={2}>
      <Box
        borderTopWidth="1px"
        borderTopStyle="dashed"
        borderTopColor="border.subtle"
        paddingTop={2}
      >
        <Text fontSize="sm" color={color} whiteSpace={preWrap ? "pre-wrap" : undefined}>
          {children}
        </Text>
      </Box>
    </Box>
  );
}

function ExpandableText({ text }: { text: string }) {
  return (
    <HoverableBigText expandedVersion={text} lineClamp={3}>
      <Box as="span" whiteSpace="pre-wrap" wordBreak="break-word">
        {text}
      </Box>
    </HoverableBigText>
  );
}

export function EvaluationStatusItem({ check }: { check: ElasticSearchEvaluation }) {
  const router = useRouter();
  const projectSlug = router.query.project as string | undefined;
  const { openDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();
  const checkType = check.type as EvaluatorTypes;

  const [evaluator] = findEvaluatorDefinitions(checkType);

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

  const customPrompt = useMemo(
    () =>
      promptSettingOf(
        isEvaluatorTable ? evaluatorQuery.data?.config : monitorQuery.data?.evaluator?.config,
      ),
    [isEvaluatorTable, evaluatorQuery.data, monitorQuery.data],
  );

  const hasEvaluatorData = isEvaluatorTable ? !!evaluatorQuery.data : !!monitorQuery.data;

  const handleOpenConfig = () => {
    if (!check.evaluator_id) return;

    if (isEvaluatorTable) {
      openDrawer("evaluatorEditor", { evaluatorId: check.evaluator_id });
    } else {
      openDrawer("onlineEvaluation", { monitorId: check.evaluator_id });
    }
  };

  const hasDetails = check.status === "processed" && check.details;
  const errorMessage =
    check.status === "error" ? (check.error?.message ?? check.details ?? null) : null;

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
              <Text
                fontWeight="semibold"
                fontSize="sm"
                lineClamp={1}
                borderBottom={check.inputs ? "1px solid" : undefined}
                borderColor="border.emphasized"
                borderStyle="dashed"
              >
                {check.name || evaluator?.name}
              </Text>
              {customPrompt && (
                <Text fontSize="xs" color="fg.subtle" lineClamp={1}>
                  <HoverableBigText expandedVersion={customPrompt} lineClamp={1}>
                    <Box as="span" whiteSpace="pre-wrap" wordBreak="break-word">
                      {customPrompt}
                    </Box>
                  </HoverableBigText>
                </Text>
              )}
              {!customPrompt && evaluator?.description && (
                <Text fontSize="xs" color="fg.subtle" lineClamp={1}>
                  {evaluator.description}
                </Text>
              )}
            </VStack>
          </HStack>
        </EvaluatorInputsTooltip>

        <Spacer />

        <ResultBadges check={check} isGuardrail={!!evaluator?.isGuardrail} passed={passed} />

        {/* Timestamp */}
        {check.timestamps.finished_at && (
          <Tooltip content={readableDate(check.timestamps.finished_at).toLocaleString()}>
            <Text
              fontSize="xs"
              color="fg.subtle"
              flexShrink={0}
              borderBottomWidth="1px"
              borderBottomColor="border.emphasized"
              borderBottomStyle="dashed"
            >
              {formatDistanceToNow(readableDate(check.timestamps.finished_at), {
                addSuffix: true,
              })}
            </Text>
          </Tooltip>
        )}

        {/* Three-dot menu */}
        {projectSlug && check.evaluator_id && hasEvaluatorData && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <IconButton variant="ghost" size="xs" aria-label="Evaluation options" flexShrink={0}>
                <MoreVertical size={14} />
              </IconButton>
            </Menu.Trigger>
            <Menu.Content minWidth="160px">
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

      {hasDetails && check.details && (
        <DetailNote color="fg.subtle">
          <ExpandableText text={check.details} />
        </DetailNote>
      )}
      {errorMessage && (
        <DetailNote color="red.fg">
          <ExpandableText text={errorMessage} />
        </DetailNote>
      )}
      {check.status === "skipped" && check.details && (
        <DetailNote color="fg.subtle" preWrap>
          {check.details}
        </DetailNote>
      )}
    </Box>
  );
}
