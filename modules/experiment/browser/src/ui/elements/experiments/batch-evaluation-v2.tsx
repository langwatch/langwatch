import {
  Alert,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Skeleton,
  Spacer,
  Spinner,
  type StackProps,
  Text,
  VStack,
} from "@chakra-ui/react";
import { formatTimeAgo } from "@langwatch/browser-host/format-time-ago";
import { Link } from "@langwatch/browser-host/link";
import type { WorkflowApiRouter, RouterOutputs } from "@langwatch/browser-trpc/workflow-api";
import { OverflownTextWithTooltip } from "@langwatch/design-system/overflown-text";
import { getColorForString } from "@langwatch/design-system/rotating-colors";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { getRunDisplayName } from "@langwatch/experiment-browser-kit";
import type { ExperimentRun } from "@langwatch/experiment-contract";
import { nowInstant } from "@langwatch/time";
import { FormatMoney } from "@langwatch/workflow-browser-kit";
import { useDejaViewLink } from "@langwatch/workflow-browser/surfaces/deja-view-link";
import { VersionBox } from "@langwatch/workflow-browser/version-history";
import type { Experiment, Project } from "@langwatch/workflow-contract";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import React from "react";
import { Download, ExternalLink } from "react-feather";

import {
  useBatchEvaluationDownloadCSV,
  useBatchEvaluationResults,
} from "../../../behavior/experiments/use-batch-evaluation-run-results.ts";
import { useBatchEvaluationState } from "../../../behavior/experiments/use-batch-evaluation-runs.ts";
import {
  BatchEvaluationV2EvaluationSummary,
  formatEvaluationSummary,
  getFinishedAt,
} from "./BatchEvaluationV2/batch-evaluation-summary.tsx";
import { BatchEvaluationV2EvaluationResults } from "./BatchEvaluationV2/batch-evaluation-v2-evaluation-results.tsx";

// Re-exported for `@langwatch/experiment-browser/batch-evaluation-state`:
// `workflow/browser`'s results-panel still calls this hook directly.
export { useBatchEvaluationState };

/**
 * The `BatchEvaluationV2` view itself is unused (kept for reference, see
 * `experiment-detail.screen.tsx`) but has no owning section to move its
 * fetch hooks into; this remains the wiring point until it is revived.
 */
export function BatchEvaluationV2({
  project,
  experiment,
}: {
  project: Project;
  experiment: Experiment;
}) {
  const { batchEvaluationRuns, selectedRun, selectedRunId, setSelectedRunId, isFinished } =
    useBatchEvaluationState({
      project,
      experiment,
    });

  const { downloadCSV, isDownloadCSVEnabled } = useBatchEvaluationDownloadCSV({
    project,
    experiment,
    runId: selectedRunId,
    isFinished,
  });

  const evaluationResults = useBatchEvaluationResults({
    project,
    experiment,
    runId: selectedRun?.runId,
    isFinished,
  });

  const dejaView = useDejaViewLink({
    aggregateId: selectedRunId,
    tenantId: project.id,
  });

  const showRunsSkeleton =
    batchEvaluationRuns.isLoading || batchEvaluationRuns.error?.data?.httpStatus === 404;
  const showRunsError = !showRunsSkeleton && !!batchEvaluationRuns.error;
  const showWaitingForResults =
    !showRunsSkeleton && !batchEvaluationRuns.error && batchEvaluationRuns.data?.runs.length === 0;
  const showResults = !showRunsSkeleton && !batchEvaluationRuns.error && !showWaitingForResults;

  return (
    <HStack align="start" width="full" height="full" gap={0}>
      <BatchEvaluationV2RunList
        batchEvaluationRuns={batchEvaluationRuns}
        selectedRun={selectedRun}
        selectedRunId={selectedRunId}
        setSelectedRunId={setSelectedRunId}
      />
      <VStack
        width="full"
        height="fit-content"
        minHeight="100%"
        position="relative"
        gap={0}
        justify="space-between"
        minWidth="0"
      >
        <VStack align="start" width="full" height="full" gap={8} padding={6}>
          <HStack width="full" align="end" gap={4}>
            <Heading as="h1" size="lg">
              {experiment.name ?? experiment.slug}
            </Heading>
            <Spacer />
            <Button
              size="sm"
              colorPalette="blue"
              onClick={() => void downloadCSV()}
              disabled={!isDownloadCSVEnabled}
              marginBottom="-6px"
            >
              <Download size={16} /> Export to CSV
            </Button>
            {experiment.workflowId && (
              <Link
                target="_blank"
                href={`/${project.slug}/studio/${experiment.workflowId}`}
                asChild
              >
                <Button size="sm" textDecoration="none" marginBottom="-6px" colorPalette="orange">
                  <ExternalLink size={16} /> Open Workflow
                </Button>
              </Link>
            )}
            {dejaView.href && (
              <Link href={dejaView.href}>
                <Button size="sm" colorPalette="gray" marginBottom="-6px">
                  DejaView
                </Button>
              </Link>
            )}
          </HStack>
          {showRunsSkeleton && <Skeleton width="100%" height="30px" />}
          {showRunsError && (
            <Alert.Root status="error">
              <Alert.Indicator />
              Error loading experiment runs
            </Alert.Root>
          )}
          {showWaitingForResults && <Text>Waiting for results...</Text>}
          {showResults && (
            <>
              <Card.Root width="100%" overflow="hidden">
                <Card.Header>
                  <Heading as="h2" size="md">
                    {selectedRun?.workflowVersion?.commitMessage ?? "Evaluation Results"}
                  </Heading>
                </Card.Header>
                <Card.Body padding={0}>
                  <BatchEvaluationV2EvaluationResults
                    project={project}
                    experiment={experiment}
                    runId={selectedRun?.runId}
                    isFinished={isFinished}
                    downloadCSV={downloadCSV}
                    isDownloadCSVEnabled={isDownloadCSVEnabled}
                    {...evaluationResults}
                  />
                </Card.Body>
              </Card.Root>
            </>
          )}
        </VStack>
        {selectedRun && <BatchEvaluationV2EvaluationSummary run={selectedRun} showProgress />}
      </VStack>
    </HStack>
  );
}

export function BatchEvaluationV2RunList({
  batchEvaluationRuns,
  selectedRun,
  selectedRunId,
  setSelectedRunId,
  size = "md",
  ...props
}: {
  batchEvaluationRuns: UseTRPCQueryResult<
    RouterOutputs["experiments"]["getExperimentBatchEvaluationRuns"],
    TRPCClientErrorLike<WorkflowApiRouter>
  >;
  selectedRun: ExperimentRun | undefined;
  selectedRunId: string | undefined;
  setSelectedRunId: (runId: string) => void;
  size?: "sm" | "md";
} & StackProps) {
  const runs: ExperimentRun[] | undefined = batchEvaluationRuns.data?.runs;
  const hasAnyVersion = runs?.some((run) => run.workflowVersion);

  const showRunsError = !batchEvaluationRuns.isLoading && !!batchEvaluationRuns.error;
  const showWaitingForRuns =
    !batchEvaluationRuns.isLoading &&
    !batchEvaluationRuns.error &&
    batchEvaluationRuns.data?.runs.length === 0;
  const showRuns =
    !batchEvaluationRuns.isLoading && !batchEvaluationRuns.error && !showWaitingForRuns;

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
      {...props}
    >
      {size !== "sm" && (
        <Heading as="h2" size="md" paddingX={6} paddingY={4}>
          Evaluation Runs
        </Heading>
      )}
      {batchEvaluationRuns.isLoading && (
        <>
          {Array.from({ length: 3 }).map((_, index) => (
            <HStack key={index} paddingX={6} paddingY={2} width="100%">
              <Skeleton width="100%" height="30px" />
            </HStack>
          ))}
        </>
      )}
      {showRunsError && (
        <Alert.Root status="error">
          <Alert.Indicator />
          Error loading experiment runs
        </Alert.Root>
      )}
      {showWaitingForRuns && (
        <Text paddingX={6} paddingY={4}>
          Waiting for runs...
        </Text>
      )}
      {showRuns && (
        <>
          {!runs?.find((r) => r.runId === selectedRunId) && (
            <HStack
              paddingX={size === "sm" ? 2 : 4}
              paddingY={size === "sm" ? 2 : 3}
              width="100%"
              cursor="pointer"
              as="button"
              background="gray.200"
              _hover={{
                background: "gray.100",
              }}
              gap={3}
            >
              <VersionBox minWidth={hasAnyVersion ? "48px" : "0"} />
              <VStack align="start" gap={2} width="100%" paddingRight={2}>
                <HStack width="100%">
                  <Skeleton height="12px" background="gray.400" flexGrow={1} />
                  <Spinner size="xs" flexShrink={0} />
                </HStack>
                <Skeleton width="100%" height="12px" background="gray.400" />
              </VStack>
            </HStack>
          )}
          {runs?.map((run, index) => {
            const runCost = (run.summary.datasetCost ?? 0) + (run.summary.evaluationsCost ?? 0);
            const runName = getRunDisplayName({
              commitMessage: run.workflowVersion?.commitMessage,
              index,
            });

            return (
              <HStack
                key={run?.runId ?? "new"}
                paddingX={size === "sm" ? 2 : 4}
                paddingY={size === "sm" ? 2 : 3}
                width="100%"
                cursor="pointer"
                as="button"
                background={selectedRun?.runId === run.runId ? "gray.200" : "none"}
                _hover={{
                  background: selectedRun?.runId === run.runId ? "gray.200" : "gray.100",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedRunId(run.runId);
                }}
                gap={3}
              >
                {run.workflowVersion ? (
                  <VersionBox
                    version={run.workflowVersion}
                    minWidth={hasAnyVersion ? "48px" : "0"}
                  />
                ) : (
                  <VersionBox
                    minWidth={hasAnyVersion ? "48px" : "0"}
                    backgroundColor={
                      run.timestamps.stoppedAt
                        ? "red.200"
                        : getColorForString("colors", run.runId).color
                    }
                  />
                )}
                <VStack align="start" gap={0}>
                  <OverflownTextWithTooltip
                    fontSize={size === "sm" ? "13px" : "14px"}
                    lineClamp={1}
                    wordBreak="break-all"
                  >
                    {runName}
                    {getFinishedAt(run.timestamps, nowInstant().epochMilliseconds) ===
                      undefined && (
                      <Spinner
                        size="xs"
                        display="inline-block"
                        marginLeft={2}
                        marginBottom="-2px"
                      />
                    )}
                  </OverflownTextWithTooltip>
                  <HStack color="fg.subtle" fontSize={size === "sm" ? "12px" : "13px"} gap={1}>
                    {Object.values(run.summary.evaluations)
                      .slice(0, 2)
                      .map((evaluation, index) => (
                        <React.Fragment key={evaluation.name}>
                          {index > 0 && <Text>·</Text>}
                          <Tooltip content={evaluation.name} positioning={{ placement: "top" }}>
                            <Text>{formatEvaluationSummary(evaluation, true)}</Text>
                          </Tooltip>
                        </React.Fragment>
                      ))}
                    {!!runCost && (
                      <>
                        {Object.keys(run.summary.evaluations).length > 0 && <Text>·</Text>}
                        <Text whiteSpace="nowrap">
                          <FormatMoney amount={runCost} currency="USD" format="$0.00[0]" />
                        </Text>
                      </>
                    )}
                  </HStack>
                  <HStack color="fg.subtle" fontSize={size === "sm" ? "12px" : "13px"}>
                    <Text whiteSpace="nowrap" lineClamp={1}>
                      {run.timestamps.createdAt
                        ? formatTimeAgo(run.timestamps.createdAt, "yyyy-MM-dd HH:mm", 5)
                        : "Waiting for steps..."}
                    </Text>
                    {run.timestamps.stoppedAt && (
                      <Box width="6px" height="6px" background="red.300" borderRadius="full" />
                    )}
                  </HStack>
                </VStack>
              </HStack>
            );
          })}
        </>
      )}
    </VStack>
  );
}
