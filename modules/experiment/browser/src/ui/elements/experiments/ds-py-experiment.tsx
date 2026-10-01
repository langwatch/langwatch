import { formatTimeAgo } from "@langwatch/browser-host/format-time-ago";
import type { UiHostProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import { formatMoney } from "@langwatch/design-system/format-money";
import {
  Alert,
  Box,
  Button,
  Card,
  Center,
  Field,
  Heading,
  HStack,
  Separator,
  Skeleton,
  Spacer,
  Spinner,
  Table,
  Tabs,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { getColorForString } from "@langwatch/design-system/rotating-colors";
import { titleCase } from "@langwatch/design-system/string-casing";
import type {
  AppliedOptimization,
  AppliedOptimizationField,
  DSPyPredictor,
  DSPyRunsSummary,
  DSPyStep,
  DSPyStepSummary,
  ExperimentRunWorkflowVersion,
} from "@langwatch/experiment-contract";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import numeral from "numeral";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "react-feather";
import {
  CartesianGrid,
  Label,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  Formatter,
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

import { getRunDisplayName } from "../../../model/batch-evaluation-results.run-display-name.ts";
import { FormatMoney } from "../workflow/format-money.tsx";

/** The runs query, with the contract's row rather than the router's inference. */
type DSPyRunsQuery = UseTRPCQueryResult<
  DSPyRunsSummary[] | undefined,
  TRPCClientErrorLike<ExperimentApiRouter>
>;

/** One optimizer step, likewise. */
type DSPyStepQuery = UseTRPCQueryResult<
  DSPyStep | undefined,
  TRPCClientErrorLike<ExperimentApiRouter>
>;
import { getRawColorValue } from "@langwatch/design-system/color-mode";
import { LLMIcon } from "@langwatch/design-system/icons";
import { Switch } from "@langwatch/design-system/switch";

import { experimentApi } from "../../../behavior/experiment-api.ts";
import { RenderInputOutput } from "../../../behavior/lent-trace.tsx";
import { VersionBox } from "../../../behavior/lent-workflow.tsx";
import type { ExperimentApiRouter, ExperimentRow } from "../../../model/experiment-api-map.ts";
import { readKey } from "../../../model/experiments/BatchEvaluationV2/utils.ts";
import { ChartTooltip } from "../analytics/chart-tooltip.tsx";
import { FeedbackLink } from "../feedback-link.tsx";
import { MetadataTag } from "../metadata-tag.tsx";

type QueryView = "loading" | "error" | "empty" | "ready";

function queryViewOf({
  isLoading,
  error,
  isEmpty,
}: {
  isLoading: boolean;
  error: unknown;
  isEmpty: boolean;
}): QueryView {
  if (isLoading) return "loading";
  if (error) return "error";
  if (isEmpty) return "empty";
  return "ready";
}

function optimizerHeading(optimizerNames: string[]): string {
  if (optimizerNames.length === 1) return optimizerNames[0]!;
  if (optimizerNames.length > 1) return "Multiple Optimizers";
  return "Waiting for the first completed step to arrive...";
}

function nextSelectedRuns({
  selectedRuns,
  runId,
  isHoldingShift,
}: {
  selectedRuns: string[] | null;
  runId: string;
  isHoldingShift: boolean;
}): string[] {
  if (selectedRuns?.includes(runId)) return selectedRuns.filter((id) => id !== runId);
  if (isHoldingShift) return [...(selectedRuns ?? []), runId];
  return [runId];
}

function ZeroCallCost({ cached }: { cached: boolean }) {
  if (!cached) return "-";
  return (
    <HStack align="start">
      <Text>$0.00</Text>
      <Text color="fg.subtle">(cached)</Text>
    </HStack>
  );
}

export function DSPyExperiment({
  project,
  experiment,
}: {
  project: UiHostProject;
  experiment: ExperimentRow;
}) {
  const {
    dspyRuns,
    selectedRuns,
    setSelectedRuns,
    highlightedRun,
    setHighlightedRun,
    selectedPoint,
    setSelectedPoint,
    dspyRunsPlusIncoming,
    stepToDisplay,
    optimizerNames,
    labelNames,
    runsById,
  } = useDSPyExperimentState({ project, experiment });
  const runsView = queryViewOf({
    isLoading: dspyRuns.isLoading,
    error: dspyRuns.error,
    isEmpty: dspyRuns.data?.length === 0,
  });

  return (
    <HStack align="start" width="full" height="full" gap={0}>
      <DSPyExperimentRunList
        dspyRuns={dspyRuns}
        selectedRuns={selectedRuns}
        setSelectedRuns={setSelectedRuns}
        setHighlightedRun={setHighlightedRun}
        dspyRunsPlusIncoming={dspyRunsPlusIncoming}
      />
      <Box width="calc(100vw - 391px)" height="full" position="relative">
        <VStack align="start" width="100%" maxWidth="1200px" height="full" gap={8} padding={6}>
          <HStack width="full" align="end">
            <Heading as="h1" size="lg">
              {experiment.name ?? experiment.slug}
            </Heading>
            <Spacer />
            <FeedbackLink />
          </HStack>
          {runsView === "loading" && <Skeleton width="100%" height="30px" />}
          {runsView === "error" && (
            <Alert.Root>
              <Alert.Indicator />
              Error loading experiment runs
            </Alert.Root>
          )}
          {runsView === "empty" && <Text>Waiting for the first completed step to arrive...</Text>}
          {runsView === "ready" && dspyRuns.data && (
            <>
              <Card.Root width="100%">
                <Card.Header>
                  <Heading as="h2" size="md">
                    {optimizerHeading(optimizerNames)}
                  </Heading>
                </Card.Header>
                <Card.Body>
                  <DSPyRunsScoresChart
                    dspyRuns={dspyRuns.data}
                    selectedPoint={selectedPoint}
                    setSelectedPoint={setSelectedPoint}
                    highlightedRun={highlightedRun}
                    selectedRuns={selectedRuns}
                    stepToDisplay={stepToDisplay}
                    labelNames={labelNames}
                  />
                </Card.Body>
              </Card.Root>
              {stepToDisplay && (!highlightedRun || highlightedRun === stepToDisplay.run_id) && (
                <Card.Root width="100%">
                  <Card.Body padding={0}>
                    <RunDetails
                      project={project}
                      experiment={experiment}
                      dspyStepSummary={stepToDisplay}
                      workflowVersion={runsById?.[stepToDisplay.run_id]?.workflow_version}
                    />
                  </Card.Body>
                </Card.Root>
              )}
            </>
          )}
        </VStack>
        {runsById && selectedRuns?.length === 1 && (
          <DSPyExperimentSummary
            project={project}
            experiment={experiment}
            run={runsById[selectedRuns[0]!]}
          />
        )}
      </Box>
    </HStack>
  );
}

/** The runs a view shows: the caller's, else the URL's, else the newest run alone. */
const resolveSelectedRunIds = ({
  selectedRuns,
  queryRunIds,
  firstRunId,
}: {
  selectedRuns: string[] | undefined;
  queryRunIds: unknown;
  firstRunId: string | undefined;
}): string[] => {
  const requested = selectedRuns ?? (typeof queryRunIds === "string" ? queryRunIds.split(",") : []);
  if (requested.length > 0) return requested;
  return firstRunId ? [firstRunId] : [];
};

/**
 * What the optimizer view derives from the loaded runs: the step the chart
 * points at, the optimizer and label names in view, and the runs list with a
 * requested run that has not reported yet placed first.
 */
const dspyRunViewOf = ({
  runs,
  visibleRuns,
  runsById,
  selectedPoint,
  requestedRunIds,
}: {
  runs: DSPyRunsSummary[] | undefined;
  visibleRuns: DSPyRunsSummary[] | undefined;
  runsById: Record<string, DSPyRunsSummary> | undefined;
  selectedPoint: { runId: string; index: string } | null;
  requestedRunIds: string[];
}) => {
  const stepToDisplay =
    runs &&
    (selectedPoint && runsById?.[selectedPoint.runId])?.steps.find(
      (step) => step.index === selectedPoint.index,
    );
  const optimizerNames = Array.from(
    new Set(visibleRuns?.flatMap((run) => run.steps.map((step) => step.optimizer.name)) ?? []),
  );
  const labelNames = Array.from(
    new Set(visibleRuns?.flatMap((run) => run.steps.map((step) => step.label)) ?? []),
  );
  const nonMatchingRunIds = Array.from(new Set(requestedRunIds)).filter(
    (runId) => !runs?.some((run) => run.runId === runId),
  );
  const dspyRunsPlusIncoming =
    nonMatchingRunIds.length > 0
      ? ([{ runId: nonMatchingRunIds[0] }, ...(runs ?? [])] as ({
          runId: string;
        } & Partial<DSPyRunsSummary>)[])
      : runs;

  return { stepToDisplay, optimizerNames, labelNames, dspyRunsPlusIncoming };
};

export const useDSPyExperimentState = ({
  project,
  experiment,
  selectedRuns,
  setSelectedRuns,
  incomingRunIds = [],
}: {
  project: UiHostProject;
  experiment: ExperimentRow;
  selectedRuns?: string[];
  setSelectedRuns?: (runs: string[]) => void;
  incomingRunIds?: string[];
}) => {
  /** The optimizer's runs, typed by `@langwatch/experiment-contract`'s own `DSPyRunsSummary`. */
  const dspyRuns = experimentApi.experiments.getExperimentDSPyRuns.useQuery(
    {
      projectId: project.id,
      experimentSlug: experiment.slug,
    },
    {
      refetchOnMount: false,
      // needs a read hint: dspy optimisation step recorded
    },
  ) as DSPyRunsQuery;

  const router = useRouter();

  const [highlightedRun, setHighlightedRun] = useState<string | null>(null);

  const selectedRuns_ = useMemo(
    () =>
      resolveSelectedRunIds({
        selectedRuns,
        queryRunIds: router.query.runIds,
        firstRunId: dspyRuns.data?.[0]?.runId,
      }),
    [dspyRuns.data, router.query.runIds, selectedRuns],
  );

  const setSelectedRuns_ = useCallback(
    (runIds: string[]) => {
      if (setSelectedRuns) {
        setSelectedRuns(runIds);
      } else {
        const query: Record<string, string | undefined> = {
          ...router.query,
          runIds: runIds.join(","),
        };
        if (!query.runIds) {
          delete query.runIds;
        }
        void router.push({ query });
      }
    },
    [router, setSelectedRuns],
  );

  const [selectedPoint, setSelectedPoint] = useState<{
    runId: string;
    index: string;
  } | null>(null);

  useEffect(() => {
    if (selectedPoint && !selectedRuns_.includes(selectedPoint.runId)) {
      setSelectedPoint(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRuns_]);

  const visibleRuns =
    dspyRuns.data && selectedRuns_
      ? dspyRuns.data.filter((run) => selectedRuns_.includes(run.runId))
      : dspyRuns.data;

  const firstVisibleRun = visibleRuns?.[0];

  useEffect(() => {
    if (!firstVisibleRun || selectedPoint !== null) return;

    const lastStep = firstVisibleRun.steps[firstVisibleRun.steps.length - 1];
    if (lastStep) {
      setSelectedPoint({ runId: firstVisibleRun.runId, index: lastStep.index });
    }
  }, [firstVisibleRun, selectedPoint]);

  const runsById = useMemo(() => {
    return dspyRuns.data?.reduce(
      (acc, run) => {
        acc[run.runId] = run;
        return acc;
      },
      {} as Record<string, DSPyRunsSummary>,
    );
  }, [dspyRuns.data]);

  const { stepToDisplay, optimizerNames, labelNames, dspyRunsPlusIncoming } = dspyRunViewOf({
    runs: dspyRuns.data,
    visibleRuns,
    runsById,
    selectedPoint,
    requestedRunIds: [...selectedRuns_, ...incomingRunIds],
  });

  return {
    dspyRuns,
    selectedRuns: selectedRuns_,
    setSelectedRuns: setSelectedRuns_,
    highlightedRun,
    setHighlightedRun,
    dspyRunsPlusIncoming,
    stepToDisplay,
    optimizerNames,
    labelNames,
    selectedPoint,
    setSelectedPoint,
    runsById,
  };
};

/** The run list's placeholder while it loads, fails, or has no runs yet. */
function DSPyRunsListStatus({ runsView }: { runsView: QueryView }) {
  if (runsView === "loading") {
    return Array.from({ length: 3 }).map((_, index) => (
      <HStack key={index} paddingX={6} paddingY={2} width="100%">
        <Skeleton width="100%" height="30px" />
      </HStack>
    ));
  }
  if (runsView === "error") {
    return (
      <Alert.Root>
        <Alert.Indicator />
        Error loading experiment runs
      </Alert.Root>
    );
  }
  if (runsView === "empty") {
    return (
      <Text paddingX={6} paddingY={4}>
        Waiting for runs...
      </Text>
    );
  }
  return null;
}

export function DSPyExperimentRunList({
  dspyRuns,
  selectedRuns,
  setSelectedRuns,
  setHighlightedRun,
  dspyRunsPlusIncoming,
  size = "md",
  incomingRunIds = [],
}: {
  dspyRuns: DSPyRunsQuery;
  selectedRuns: string[] | null;
  setSelectedRuns: (runs: string[]) => void;
  setHighlightedRun: (runId: string | null) => void;
  dspyRunsPlusIncoming:
    | ({
        runId: string;
      } & Partial<DSPyRunsSummary>)[]
    | undefined;
  size?: "md" | "sm";
  incomingRunIds?: string[];
}) {
  const hasAnyVersion = dspyRunsPlusIncoming?.some((run) => run.workflow_version);

  // Map real run IDs to their chronological index for stable "Run #N" numbering
  const runIndexById = useMemo(
    () => new Map((dspyRuns.data ?? []).map((realRun, realIndex) => [realRun.runId, realIndex])),
    [dspyRuns.data],
  );

  const runsView = queryViewOf({
    isLoading: dspyRuns.isLoading,
    error: dspyRuns.error,
    isEmpty: dspyRuns.data?.length === 0,
  });

  return (
    <VStack
      align="start"
      background="bg.surface"
      paddingY={size === "sm" ? 0 : 4}
      borderRightWidth="1px"
      borderColor="border.emphasized"
      fontSize="14px"
      minWidth={size === "sm" ? "250px" : "300px"}
      maxWidth={size === "sm" ? "250px" : "300px"}
      height="full"
      gap={0}
      overflowY="auto"
    >
      {size !== "sm" && (
        <Heading as="h2" size="md" paddingX={6} paddingY={4}>
          DSPy Optimizer Runs
        </Heading>
      )}
      <DSPyRunsListStatus runsView={runsView} />
      {runsView === "ready" &&
        dspyRunsPlusIncoming?.slice(0, 21).map((run) => {
          const runCost = run.steps
            ?.map((step) => step.llm_calls_summary.total_cost)
            .reduce((acc, cost) => acc + cost, 0);
          const runName = getRunDisplayName({
            commitMessage: run.workflow_version?.commitMessage,
            index: runIndexById.get(run.runId) ?? 0,
          });

          return (
            <HStack
              key={run?.runId ?? "new"}
              paddingX={size === "sm" ? 2 : 6}
              paddingY={size === "sm" ? 2 : 4}
              width="100%"
              cursor="pointer"
              as="button"
              opacity={!selectedRuns || selectedRuns.includes(run.runId) ? 1 : 0.5}
              background={selectedRuns?.includes(run.runId) ? "gray.200" : "none"}
              _hover={{
                background: selectedRuns?.includes(run.runId) ? "gray.200" : "gray.100",
              }}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const isHoldingShift = e.shiftKey;

                if (isHoldingShift) {
                  document.getSelection()?.removeAllRanges();
                }

                setSelectedRuns?.(
                  nextSelectedRuns({ selectedRuns, runId: run.runId, isHoldingShift }),
                );
                setHighlightedRun(null);
              }}
              gap={3}
            >
              {!dspyRuns.data?.find((r) => r.runId === run.runId) ? (
                <>
                  <VersionBox minWidth={hasAnyVersion ? "48px" : "0"} />
                  <VStack align="start" gap={2} width="100%" paddingRight={2}>
                    <HStack width="100%">
                      <Skeleton height="12px" background="gray.400" flexGrow={1} />
                      <Spinner size="xs" flexShrink={0} />
                    </HStack>
                    <Skeleton width="100%" height="12px" background="gray.400" />
                  </VStack>
                </>
              ) : (
                <LoadedRunSummary
                  run={run}
                  runName={runName}
                  runCost={runCost}
                  hasAnyVersion={hasAnyVersion}
                  size={size}
                  incomingRunIds={incomingRunIds}
                />
              )}
            </HStack>
          );
        })}
    </VStack>
  );
}

function LoadedRunSummary({
  run,
  runName,
  runCost,
  hasAnyVersion,
  size,
  incomingRunIds,
}: {
  run: { runId: string } & Partial<DSPyRunsSummary>;
  runName: string;
  runCost: number | undefined;
  hasAnyVersion: boolean | undefined;
  size: "md" | "sm";
  incomingRunIds: string[];
}) {
  return (
    <>
      {run.workflow_version ? (
        <VersionBox version={run.workflow_version} minWidth={hasAnyVersion ? "48px" : "0"} />
      ) : (
        <Box
          width="24px"
          height="24px"
          minWidth="24px"
          minHeight="24px"
          background="gray.300"
          borderRadius="100%"
          backgroundColor={getColorForString("colors", run.runId).color}
        />
      )}
      <VStack width="full" align="start" gap={0} paddingRight={2}>
        <HStack width="full">
          {run.workflow_version && (
            <Box
              width="12px"
              height="12px"
              minWidth="12px"
              minHeight="12px"
              background="gray.300"
              borderRadius="100%"
              backgroundColor={getColorForString("colors", run.runId).color}
            />
          )}
          <Text fontSize={size === "sm" ? "13px" : "14px"}>{runName}</Text>
          {(incomingRunIds ?? []).includes(run.runId) && (
            <>
              <Spacer />
              <Spinner size="xs" />
            </>
          )}
        </HStack>

        <HStack color="fg.subtle" fontSize={size === "sm" ? "12px" : "13px"}>
          <Text>
            {run.created_at
              ? formatTimeAgo(run.created_at, "yyyy-MM-dd HH:mm", 5)
              : "Waiting for steps..."}
          </Text>
          {runCost && (
            <>
              <Text>·</Text>
              <Text>{formatMoney({ amount: runCost, currency: "USD" }, "$0.00[0]")}</Text>
            </>
          )}
        </HStack>
      </VStack>
    </>
  );
}

type DSPyPredictorEntry = DSPyStep["predictors"][number];
type DSPyExample = DSPyStep["examples"][number];
type DSPyLLMCall = DSPyStep["llm_calls"][number];

const stepCostOf = (summary: DSPyStepSummary) =>
  formatMoney({ amount: summary.llm_calls_summary.total_cost, currency: "USD" }, "$0.00[00]");

const stepTokensOf = (summary: DSPyStepSummary) =>
  numeral(summary.llm_calls_summary.total_tokens).format("0a");

const stepScoreOf = (summary: DSPyStepSummary) => numeral(summary.score).format("0.[00]");

/** The loading, error and empty rows of a step table; nothing once it has entries. */
const QueryStatusRows = ({
  view,
  skeletonCells,
  colSpan,
}: {
  view: QueryView;
  skeletonCells: number;
  colSpan: number;
}) => {
  if (view === "loading") {
    return Array.from({ length: 3 }).map((_, index) => (
      <Table.Row key={index}>
        <Table.Cell background="gray.50">&nbsp;</Table.Cell>
        {Array.from({ length: skeletonCells }).map((_, cell) => (
          <Table.Cell key={cell}>
            <Skeleton width="100%" height="30px" />
          </Table.Cell>
        ))}
      </Table.Row>
    ));
  }
  if (view === "error") {
    return (
      <Table.Row>
        <Table.Cell colSpan={colSpan} color="red.600">
          Error loading step data
        </Table.Cell>
      </Table.Row>
    );
  }
  if (view === "empty") {
    return (
      <Table.Row>
        <Table.Cell colSpan={colSpan}>No entries</Table.Cell>
      </Table.Row>
    );
  }
  return null;
};

const PredictorRow = ({
  index,
  name,
  predictor,
}: {
  index: number;
  name: DSPyPredictorEntry["name"];
  predictor: DSPyPredictorEntry["predictor"];
}) => {
  const signature = predictor?.extended_signature ?? predictor?.signature;
  return (
    <Table.Row>
      <Table.Cell background="gray.50" textAlign="center">
        {index + 1}
      </Table.Cell>
      <Table.Cell>{name}</Table.Cell>
      <Table.Cell whiteSpace="pre-wrap">{signature?.instructions ?? "-"}</Table.Cell>
      <Table.Cell>
        <CollapsableSignature signature={signature} />
      </Table.Cell>
      <Table.Cell>
        {predictor?.demos ? (
          <RenderInputOutput
            value={JSON.stringify(
              predictor.demos.map((demo: unknown) => readKey(demo, "_store") || demo),
            )}
            collapseStringsAfterLength={140}
            shouldCollapse={(field) => field.type === "array"}
            displayObjectSize={true}
          />
        ) : (
          "-"
        )}
      </Table.Cell>
    </Table.Row>
  );
};

const ExampleRow = ({
  index,
  example,
  hasTrace,
}: {
  index: number;
  example: DSPyExample;
  hasTrace: boolean;
}) => (
  <Table.Row>
    <Table.Cell background="gray.50" textAlign="center">
      {index + 1}
    </Table.Cell>
    <Table.Cell>
      <RenderInputOutput value={JSON.stringify(example.example)} collapseStringsAfterLength={140} />
    </Table.Cell>
    <Table.Cell>
      <RenderInputOutput value={JSON.stringify(example.pred)} collapseStringsAfterLength={140} />
    </Table.Cell>
    <Table.Cell>{example.score}</Table.Cell>
    {hasTrace && (
      <Table.Cell>
        <RenderInputOutput
          value={JSON.stringify(example.trace)}
          collapseStringsAfterLength={140}
          collapsed={true}
        />
      </Table.Cell>
    )}
  </Table.Row>
);

const LLMCallRow = ({ index, llmCall }: { index: number; llmCall: DSPyLLMCall }) => {
  const response = llmCall.response?.choices?.[0]?.message?.content ?? llmCall.response?.output;
  return (
    <Table.Row>
      <Table.Cell background="gray.50" textAlign="center">
        {index + 1}
      </Table.Cell>
      <Table.Cell>{llmCall.model}</Table.Cell>
      <Table.Cell>
        <RenderInputOutput
          value={JSON.stringify(llmCall.response?.prompt ?? llmCall.response?.messages)}
          collapseStringsAfterLength={140}
          collapsed={true}
        />
      </Table.Cell>
      <Table.Cell>
        {response ? (
          response
        ) : (
          <RenderInputOutput
            value={JSON.stringify(llmCall.response)}
            collapseStringsAfterLength={140}
            collapsed={true}
          />
        )}
      </Table.Cell>
      <Table.Cell>
        {llmCall.cost ? (
          formatMoney({ amount: llmCall.cost, currency: "USD" }, "$0.00[0000]")
        ) : (
          <ZeroCallCost cached={!!llmCall.response.cached} />
        )}
      </Table.Cell>
    </Table.Row>
  );
};

const RunColorMark = ({
  runId,
  workflowVersion,
}: {
  runId: string;
  workflowVersion?: ExperimentRunWorkflowVersion;
}) => {
  const color = getColorForString("colors", runId).color;
  if (!workflowVersion) {
    return <Box width="24px" height="24px" borderRadius="100%" background={color} />;
  }
  return (
    <>
      <VersionBox version={workflowVersion} />
      <Box
        width="18px"
        height="18px"
        background="gray.300"
        borderRadius="100%"
        backgroundColor={color}
      />
    </>
  );
};

const RunDetailsHeader = ({
  dspyStepSummary,
  workflowVersion,
}: {
  dspyStepSummary: DSPyStepSummary;
  workflowVersion?: ExperimentRunWorkflowVersion;
}) => {
  const runName = workflowVersion?.commitMessage ?? dspyStepSummary.run_id;
  const { label } = dspyStepSummary;
  return (
    <HStack width="full" gap={8} padding={4}>
      <HStack gap={3}>
        <RunColorMark runId={dspyStepSummary.run_id} workflowVersion={workflowVersion} />
        <Heading as="h2" size="md" marginTop="-1px">
          {runName} (step {dspyStepSummary.index})
        </Heading>
      </HStack>
      <Spacer />
      <HStack>
        <MetadataTag label="Step Cost" value={stepCostOf(dspyStepSummary)} />
        <MetadataTag label="Step Tokens" value={stepTokensOf(dspyStepSummary)} />
        <MetadataTag
          label={label === "score" ? "Step " + titleCase(label) : titleCase(label)}
          value={stepScoreOf(dspyStepSummary)}
        />
      </HStack>
    </HStack>
  );
};

const StepSummaryInline = ({ dspyStepSummary }: { dspyStepSummary: DSPyStepSummary }) => (
  <>
    <Spacer />
    <HStack paddingX={4} color="fg.muted" fontSize="12px" textTransform="uppercase">
      <Text>Step Cost: {stepCostOf(dspyStepSummary)}</Text>
      <Separator orientation="vertical" />
      <Text>Step Tokens: {stepTokensOf(dspyStepSummary)}</Text>
      <Separator orientation="vertical" />
      <Text>
        {dspyStepSummary.label === "score"
          ? "Step " + dspyStepSummary.label
          : dspyStepSummary.label}
        : {stepScoreOf(dspyStepSummary)}
      </Text>
    </HStack>
  </>
);

export const RunDetails = React.memo(
  function RunDetails({
    project,
    experiment,
    dspyStepSummary,
    workflowVersion,
    size = "md",
  }: {
    project: UiHostProject;
    experiment: ExperimentRow;
    dspyStepSummary: DSPyStepSummary;
    workflowVersion?: ExperimentRunWorkflowVersion;
    size?: "md" | "sm";
  }) {
    const dspyStep = experimentApi.experiments.getExperimentDSPyStep.useQuery(
      {
        projectId: project.id,
        experimentSlug: experiment.slug,
        runId: dspyStepSummary?.run_id ?? "",
        index: dspyStepSummary?.index ?? "",
      },
      {
        enabled: !!dspyStepSummary,
      },
    ) as DSPyStepQuery;

    const [tabIndex, setTabIndex] = useState(0);
    const [displayRawParams, setDisplayRawParams] = useState(false);
    const hasTrace = dspyStep.data?.examples.some((example) => example.trace);
    const stepView = queryViewOf({
      isLoading: dspyStep.isLoading,
      error: dspyStep.error,
      isEmpty: false,
    });
    const predictorsView = queryViewOf({
      isLoading: dspyStep.isLoading,
      error: dspyStep.error,
      isEmpty: dspyStep.data?.predictors.length === 0,
    });
    const examplesView = queryViewOf({
      isLoading: dspyStep.isLoading,
      error: dspyStep.error,
      isEmpty: dspyStep.data?.examples.length === 0,
    });
    const llmCallsView = queryViewOf({
      isLoading: dspyStep.isLoading,
      error: dspyStep.error,
      isEmpty: dspyStep.data?.llm_calls.length === 0,
    });

    return (
      <VStack width="full" height="full" gap={0} minWidth="0">
        {size !== "sm" && (
          <RunDetailsHeader dspyStepSummary={dspyStepSummary} workflowVersion={workflowVersion} />
        )}
        <Tabs.Root
          value={tabIndex.toString()}
          onValueChange={(e) => setTabIndex(parseInt(e.value))}
          size={size}
          width="full"
          height="full"
          display="flex"
          flexDirection="column"
          minWidth="0"
          colorPalette="blue"
          // Every panel here (Predictors, Evaluations, LLM Calls) is a
          // read-only render of the same dspyStep query with no
          // user-entered state, so fully unmounting inactive tabs is safe.
          lazyMount
          unmountOnExit
        >
          <Tabs.List position="relative" overflowX="auto" overflowY="hidden" whiteSpace="nowrap">
            {size === "sm" && (
              <Center
                minHeight="31px"
                marginBottom="-2px"
                paddingX={4}
                fontWeight={500}
                color="fg.muted"
                background="gray.100"
              >
                <Text>Step {dspyStepSummary.index}</Text>
              </Center>
            )}
            {tabIndex === 0 && size !== "sm" && (
              <Box position="absolute" top={0} right={4}>
                <HStack>
                  <Text>Raw</Text>
                  <Field.Root>
                    <Switch
                      checked={displayRawParams}
                      onCheckedChange={() => setDisplayRawParams(!displayRawParams)}
                    />
                  </Field.Root>
                </HStack>
              </Box>
            )}
            <Tabs.Trigger value="0">
              Predictors {dspyStep.data && `(${dspyStep.data.predictors.length})`}
            </Tabs.Trigger>
            <Tabs.Trigger value="1">
              Evaluations {dspyStep.data && `(${dspyStep.data.examples.length})`}
            </Tabs.Trigger>
            <Tabs.Trigger value="2">
              LLM Calls {dspyStep.data && `(${dspyStep.data.llm_calls.length})`}
            </Tabs.Trigger>
            {size === "sm" && <StepSummaryInline dspyStepSummary={dspyStepSummary} />}
          </Tabs.List>

          <Tabs.Content
            value="0"
            width="full"
            height="full"
            minWidth="0"
            overflowX="auto"
            display="flex"
            padding={0}
            paddingTop={displayRawParams ? 4 : 0}
          >
            {stepView === "loading" && <Skeleton width="100%" height="30px" />}
            {stepView === "error" && (
              <Alert.Root>
                <Alert.Indicator />
                Error loading step data
              </Alert.Root>
            )}
            {stepView === "ready" && dspyStep.data && displayRawParams && (
              <RenderInputOutput
                value={JSON.stringify(dspyStep.data?.predictors)}
                collapseStringsAfterLength={140}
              />
            )}
            {stepView === "ready" && dspyStep.data && !displayRawParams && (
              <Table.Root
                height="fit-content"
                // @ts-expect-error: Chakra Table.Root prop types don't include
                // custom theme tokens
                size={size === "sm" ? "xs" : "sm"}
                // @ts-expect-error: Chakra Table.Root prop types don't include
                // custom theme tokens
                variant="grid"
              >
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader
                      minWidth="15px"
                      maxWidth="15px"
                      paddingY={3}
                    ></Table.ColumnHeader>
                    <Table.ColumnHeader width="10%" paddingY={3}>
                      Name
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="25%" paddingY={3}>
                      Instructions
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="25%" paddingY={3}>
                      Signature
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="40%" paddingY={3}>
                      Demonstrations
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  <QueryStatusRows view={predictorsView} skeletonCells={4} colSpan={5} />
                  {predictorsView === "ready" &&
                    dspyStep.data &&
                    dspyStep.data.predictors.map(({ name, predictor }, index) => (
                      <PredictorRow key={index} index={index} name={name} predictor={predictor} />
                    ))}
                </Table.Body>
              </Table.Root>
            )}
          </Tabs.Content>
          <Tabs.Content
            value="1"
            width="full"
            height="full"
            minWidth="0"
            overflowX="auto"
            display="flex"
            padding={0}
          >
            {tabIndex === 1 && (
              <Table.Root
                height="fit-content"
                // @ts-expect-error: Chakra Table.Root prop types don't include
                // custom theme tokens
                size={size === "sm" ? "xs" : "sm"}
                // @ts-expect-error: Chakra Table.Root prop types don't include
                // custom theme tokens
                variant="grid"
              >
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader
                      minWidth="15px"
                      maxWidth="15px"
                      paddingY={3}
                    ></Table.ColumnHeader>
                    <Table.ColumnHeader width="30%" paddingY={3}>
                      Example
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="50%" paddingY={3}>
                      Prediction
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="20%" paddingY={3}>
                      Score
                    </Table.ColumnHeader>
                    {hasTrace && (
                      <Table.ColumnHeader minWidth="200px" paddingY={3}>
                        Trace
                      </Table.ColumnHeader>
                    )}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  <QueryStatusRows view={examplesView} skeletonCells={3} colSpan={4} />
                  {examplesView === "ready" &&
                    dspyStep.data &&
                    dspyStep.data.examples.map((example, index) => (
                      <ExampleRow
                        key={index}
                        index={index}
                        example={example}
                        hasTrace={!!hasTrace}
                      />
                    ))}
                </Table.Body>
              </Table.Root>
            )}
          </Tabs.Content>
          <Tabs.Content
            value="2"
            width="full"
            height="full"
            minWidth="0"
            overflowX="auto"
            display="flex"
            padding={0}
          >
            <Table.Root
              height="fit-content"
              // @ts-expect-error: Chakra Table.Root prop types don't include
              // custom theme tokens
              size={size === "sm" ? "xs" : "sm"}
              // @ts-expect-error: Chakra Table.Root prop types don't include
              // custom theme tokens
              variant="grid"
            >
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader
                    minWidth="15px"
                    maxWidth="15px"
                    paddingY={3}
                  ></Table.ColumnHeader>
                  <Table.ColumnHeader width="20%" paddingY={3}>
                    Model
                  </Table.ColumnHeader>
                  <Table.ColumnHeader width="25%" paddingY={3}>
                    Messages
                  </Table.ColumnHeader>
                  <Table.ColumnHeader width="45%" paddingY={3}>
                    Response
                  </Table.ColumnHeader>
                  <Table.ColumnHeader width="10%" paddingY={3}>
                    Cost
                  </Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                <QueryStatusRows view={llmCallsView} skeletonCells={4} colSpan={6} />
                {llmCallsView === "ready" &&
                  dspyStep.data &&
                  dspyStep.data.llm_calls.map((llmCall, index) => (
                    <LLMCallRow key={index} index={index} llmCall={llmCall} />
                  ))}
              </Table.Body>
            </Table.Root>
          </Tabs.Content>
        </Tabs.Root>
      </VStack>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.project.id === nextProps.project.id &&
      prevProps.experiment.slug === nextProps.experiment.slug &&
      prevProps.dspyStepSummary?.run_id === nextProps.dspyStepSummary?.run_id &&
      prevProps.dspyStepSummary?.index === nextProps.dspyStepSummary?.index
    );
  },
);

function CollapsableSignature({
  signature,
}: {
  signature: { signature?: string; fields?: Record<string, unknown> } | undefined;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <VStack>
      <HStack>
        <Button
          size="sm"
          fontSize="14px"
          fontWeight="normal"
          variant="ghost"
          onClick={() => setIsOpen(!isOpen)}
        >
          {signature?.signature ?? "-"}
          {isOpen ? <ChevronUp width="12px" /> : <ChevronDown width="12px" />}
        </Button>
      </HStack>
      {isOpen && signature?.fields ? (
        <RenderInputOutput
          value={JSON.stringify(
            Object.fromEntries(
              Object.entries(signature.fields).map(([key, value]) => {
                return [
                  key,
                  Object.fromEntries(
                    Object.entries(value ?? {}).filter(([key]) => key !== "__class__"),
                  ),
                ];
              }),
            ),
          )}
          collapseStringsAfterLength={140}
          collapsed={false}
        />
      ) : null}
    </VStack>
  );
}

type StepPoint = { index: string } & Record<string, number>;
type ChartPoint = { runId: string; index: string };

/** A highlighted run shows alone; otherwise the selected runs, or every run. */
const isRunVisible = ({
  runId,
  selectedRuns,
  highlightedRun,
}: {
  runId: string;
  selectedRuns: string[] | null;
  highlightedRun: string | null;
}) => {
  if (highlightedRun) return highlightedRun === runId;
  return !selectedRuns || selectedRuns.includes(runId);
};

/** One chart point per step index, carrying each run's score, label and version. */
const stepsByIndexOf = (runs: DSPyRunsSummary[]) =>
  runs.reduce(
    (acc, run) => {
      run.steps.forEach((step) => {
        acc[step.index] = {
          ...acc[step.index],
          index: step.index,
          [run.runId]: step.score,
          [`${run.runId}_label`]: step.label,
          [`${run.runId}_version`]: run.workflow_version?.version,
        } as StepPoint;
      });
      return acc;
    },
    {} as Record<string, StepPoint>,
  );

/** Step indexes are dotted ("1.2.3"); compare them part by part. */
const compareStepIndex = (a: StepPoint, b: StepPoint) => {
  const aParts = a.index.split(".").map(Number);
  const bParts = b.index.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
};

const runColorOf = (runId: string) => {
  const [name, number] = getColorForString("colors", runId).color.split(".");
  return getRawColorValue(name && number ? `${name}.${number}` : "gray.300");
};

const bestScoreOf = (data: StepPoint[], runId: string | undefined) =>
  data.reduce(
    (best, point) => {
      const score = point[runId ?? ""];
      return score !== undefined && score > best.score ? { score, index: point.index } : best;
    },
    { score: -Infinity, index: "" },
  );

/** Clicking the selected point again, or empty space, clears the selection. */
const nextSelectedPoint = (hovered: ChartPoint | null, selected: ChartPoint | null) => {
  if (!hovered) return null;
  const isSame = hovered.runId === selected?.runId && hovered.index === selected?.index;
  return isSame ? null : hovered;
};

const hoveredPointOf = (
  state: {
    isTooltipActive: boolean;
    activeIndex: number | string | null | undefined;
    activeLabel: string | number | undefined;
  },
  data: StepPoint[],
): ChartPoint | null => {
  const { activeIndex, activeLabel } = state;
  if (!state.isTooltipActive || activeIndex === undefined || activeIndex === null) return null;
  const runId = data[Number(activeIndex)]?.runId;
  if (!runId || activeLabel === undefined) return null;
  return { runId: runId.toString(), index: activeLabel.toString() };
};

const scoreTooltipFormatter: Formatter<ValueType, NameType> = (value, name, item) => {
  const label: unknown = item.payload[`${name}_label`];
  const version: unknown = item.payload[`${name}_version`];
  const versionTag = typeof version === "string" || typeof version === "number" ? version : null;
  return [
    numeral(value).format("0.[00]"),
    [versionTag ? `[${versionTag}]` : name, label].filter((x) => x).join(" "),
  ];
};

export function DSPyRunsScoresChart({
  dspyRuns,
  selectedPoint,
  setSelectedPoint,
  highlightedRun,
  selectedRuns,
  stepToDisplay,
  labelNames,
}: {
  dspyRuns: DSPyRunsSummary[];
  selectedPoint: { runId: string; index: string } | null;
  setSelectedPoint: (value: { runId: string; index: string } | null) => void;
  highlightedRun: string | null;
  selectedRuns: string[] | null;
  stepToDisplay: DSPyStepSummary | undefined;
  labelNames: string[];
}) {
  const runIsVisible = (runId: string) => isRunVisible({ runId, selectedRuns, highlightedRun });
  const stepsFlattenedByIndex = stepsByIndexOf(dspyRuns.filter((run) => runIsVisible(run.runId)));
  const data = Object.values(stepsFlattenedByIndex).toSorted(compareStepIndex);

  const getColor = runColorOf;

  const [hoveredRunIndex, setHoveredRunIndex] = useState<{
    runId: string;
    index: string;
  } | null>(null);

  const firstSelectedRun = selectedRuns?.[0];

  const bestScore = useMemo(() => bestScoreOf(data, firstSelectedRun), [data, firstSelectedRun]);

  return (
    <Box width="100%" position="relative">
      {data.length === 0 && (
        <Box position="absolute" top="50%" left="50%" transform="translate(-50%, -50%)">
          It can take up to 5 minutes for the first steps to arrive,
          <br />
          check the logs for progress meanwhile
        </Box>
      )}
      <ResponsiveContainer height={300}>
        <LineChart
          data={data}
          margin={{ top: 28, right: 30, left: 20, bottom: 15 }}
          style={{
            cursor: hoveredRunIndex ? "pointer" : "default",
          }}
          onClick={() => setSelectedPoint(nextSelectedPoint(hoveredRunIndex, selectedPoint))}
          onMouseMove={(state) => setHoveredRunIndex(hoveredPointOf(state, data))}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="index"
            name="Step"
            label={{
              value: "Step",
              position: "insideBottomRight",
              offset: -10,
            }}
          />
          <YAxis
            type="number"
            name={labelNames.length === 1 ? labelNames[0] : "Score"}
            label={{
              value: labelNames.length === 1 ? labelNames[0] : "Score",
              angle: -90,
              position: "insideLeft",
              offset: -5,
              style: { textAnchor: "middle" },
            }}
          />
          <Tooltip
            content={<ChartTooltip />}
            labelFormatter={(value) => `Step ${value}`}
            formatter={scoreTooltipFormatter}
          />
          {bestScore.index && (
            <ReferenceDot x={bestScore.index} y={bestScore.score} r={8} fill="gold" stroke="none">
              <Label
                value="Best"
                position="top"
                offset={10}
                fill={getRawColorValue("gray.700")}
                fontSize="12px"
              />
            </ReferenceDot>
          )}
          {dspyRuns.map(({ runId }) =>
            runIsVisible(runId) ? (
              <Line
                key={runId}
                type="monotone"
                dataKey={runId}
                stroke={getColor(runId)}
                name={runId}
                dot={{
                  r: 5,
                  fill: getColor(runId),
                }}
                isAnimationActive={false}
              />
            ) : null,
          )}
          {stepToDisplay && (!highlightedRun || highlightedRun === stepToDisplay.run_id) && (
            <ReferenceDot
              x={stepToDisplay.index}
              y={stepsFlattenedByIndex[stepToDisplay.index]?.[stepToDisplay.run_id]}
              stroke={getColor(stepToDisplay.run_id)}
              fill={getColor(stepToDisplay.run_id)}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function DSPyExperimentSummary({
  project,
  experiment,
  run,
  onApply,
  onViewLogs,
}: {
  project: UiHostProject;
  experiment: ExperimentRow;
  run: DSPyRunsSummary | undefined;
  onApply?: (appliedOptimizations: AppliedOptimization[]) => void;
  onViewLogs?: () => void;
}) {
  const { selectedPoint } = useDSPyExperimentState({
    project,
    experiment,
  });

  const { totalCost, bestScore, bestScoreStepSummary, bestScoreLabel } = useMemo(() => {
    const totalCost = run?.steps
      ?.map((step) => step.llm_calls_summary.total_cost)
      .reduce((acc, cost) => acc + cost, 0);
    const bestScore = run?.steps
      ?.map((step) => step.score)
      .reduce((acc, score) => (score > acc ? score : acc), 0);
    const bestScoreStepSummary = run?.steps?.find((step) => step.score === bestScore);
    const bestScoreLabel = bestScoreStepSummary?.label;

    return { totalCost, bestScore, bestScoreStepSummary, bestScoreLabel };
  }, [run]);

  const bestScoreStep = experimentApi.experiments.getExperimentDSPyStep.useQuery(
    {
      projectId: project.id,
      experimentSlug: experiment.slug,
      runId: bestScoreStepSummary?.run_id ?? "",
      index: bestScoreStepSummary?.index ?? "",
    },
    {
      enabled: !!bestScoreStepSummary && !!onApply,
    },
  );

  const selectedPointStep = experimentApi.experiments.getExperimentDSPyStep.useQuery(
    {
      projectId: project.id,
      experimentSlug: experiment.slug,
      runId: selectedPoint?.runId ?? "",
      index: selectedPoint?.index ?? "",
    },
    {
      enabled: !!selectedPoint,
    },
  );

  const onApplyOptimization = (predictors: DSPyPredictor[]) => {
    const appliedOptimizations: AppliedOptimization[] = predictors.map((predictor) => {
      const signatureFields: Record<string, Partial<AppliedOptimizationField>> = predictor.predictor
        .signature?.fields ?? {};
      const optimization: AppliedOptimization = {
        id: predictor.name,
        instructions:
          predictor.predictor.extended_signature?.instructions ??
          predictor.predictor.signature?.instructions,
        fields: Object.entries(signatureFields).map(([key, value]) => {
          const field: AppliedOptimizationField = {
            identifier: key,
            field_type: value.field_type ?? "input",
            prefix: value.prefix,
            desc: value.desc,
          };

          return field;
        }),
        demonstrations: predictor.predictor.demos
          ?.map((demo: unknown) => readKey(demo, "_store") ?? demo)
          .filter(Boolean),
      };
      return optimization;
    });

    if (onApply) {
      onApply(appliedOptimizations);
    }
  };

  return (
    <HStack
      position="sticky"
      left={0}
      bottom={0}
      width="100%"
      background="bg.surface"
      borderTop="1px solid"
      borderColor="border"
      paddingY={4}
      paddingX={6}
      gap={5}
    >
      <VStack align="start" gap={1}>
        <Text fontWeight="500" lineClamp={1}>
          {!bestScoreLabel || bestScoreLabel === "score" ? "Best Score" : titleCase(bestScoreLabel)}
        </Text>
        <Text lineClamp={1} whiteSpace="nowrap">
          {numeral(bestScore).format("0.[00]")}
        </Text>
      </VStack>
      <Separator orientation="vertical" height="48px" />
      <VStack align="start" gap={1}>
        <Text fontWeight="500" lineClamp={1}>
          Total Cost
        </Text>
        <Text lineClamp={1} whiteSpace="nowrap">
          {run && totalCost ? (
            <FormatMoney amount={totalCost} currency="USD" format="$0.00[00]" />
          ) : (
            "-"
          )}
        </Text>
      </VStack>
      <Spacer />
      {onViewLogs && (
        <Button size="sm" onClick={onViewLogs} variant="ghost">
          View Logs
        </Button>
      )}
      {selectedPoint && onApply && (
        <Button
          size="md"
          variant="ghost"
          onClick={() => {
            if (!selectedPoint || !selectedPointStep.data) return;
            onApplyOptimization(selectedPointStep.data.predictors);
          }}
        >
          Apply Selected Step
        </Button>
      )}
      {bestScoreStep.data && onApply && (
        <Button
          size="md"
          colorPalette="green"
          onClick={() => {
            if (!bestScoreStep.data) return;
            onApplyOptimization(bestScoreStep.data.predictors);
          }}
        >
          <LLMIcon /> Apply Best Optimization
        </Button>
      )}
    </HStack>
  );
}
