import {
  Alert,
  Box,
  Button,
  Card,
  HStack,
  Heading,
  Skeleton,
  Spacer,
  Spinner,
  Text,
  VStack,
  type StackProps,
} from "@chakra-ui/react";
import type { Experiment, Project } from "@prisma/client";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, ExternalLink } from "react-feather";
import { Link } from "../../components/ui/link";
import { Tooltip } from "../../components/ui/tooltip";
import { FormatMoney } from "../../optimization_studio/components/FormatMoney";
import { VersionBox } from "../../optimization_studio/components/History";
import type { AppRouter } from "../../server/api/root";
import { api } from "../../utils/api";
import { formatTimeAgo } from "../../utils/formatTimeAgo";
import { getColorForString } from "../../utils/rotatingColors";
import {
  BatchEvaluationV2EvaluationSummary,
  formatEvaluationSummary,
  getFinishedAt,
} from "./BatchEvaluationV2/BatchEvaluationSummary";
import {
  BatchEvaluationV2EvaluationResults,
  useBatchEvaluationDownloadCSV,
} from "./BatchEvaluationV2/BatchEvaluationV2EvaluationResults";
import React from "react";

export function BatchEvaluationV2({
  project,
  experiment,
}: {
  project: Project;
  experiment: Experiment;
}) {
  const {
    batchEvaluationRuns,
    selectedRun,
    selectedRunId,
    setSelectedRunId,
    isFinished,
  } = useBatchEvaluationState({
    project,
    experiment,
  });

  const { downloadCSV, isDownloadCSVEnabled } = useBatchEvaluationDownloadCSV({
    project,
    experiment,
    runId: selectedRunId,
    isFinished,
  });

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
                <Button
                  size="sm"
                  textDecoration="none"
                  marginBottom="-6px"
                  colorPalette="orange"
                >
                  <ExternalLink size={16} /> Open Workflow
                </Button>
              </Link>
            )}
          </HStack>
          {batchEvaluationRuns.isLoading ||
          (batchEvaluationRuns.error &&
            batchEvaluationRuns.error.data?.httpStatus == 404) ? (
            <Skeleton width="100%" height="30px" />
          ) : batchEvaluationRuns.error ? (
            <Alert.Root status="error">
              <Alert.Indicator />
              Error loading experiment runs
            </Alert.Root>
          ) : batchEvaluationRuns.data?.runs.length === 0 ? (
            <Text>Waiting for results...</Text>
          ) : (
            <>
              <Card.Root width="100%">
                <Card.Header>
                  <Heading as="h2" size="md">
                    {selectedRun?.workflow_version?.commitMessage ??
                      "Evaluation Results"}
                  </Heading>
                </Card.Header>
                <Card.Body paddingTop={0}>
                  <BatchEvaluationV2EvaluationResults
                    project={project}
                    experiment={experiment}
                    runId={selectedRun?.run_id}
                    isFinished={isFinished}
                  />
                </Card.Body>
              </Card.Root>
            </>
          )}
        </VStack>
        {selectedRun && (
          <BatchEvaluationV2EvaluationSummary run={selectedRun} showProgress />
        )}
      </VStack>
    </HStack>
  );
}

export const useBatchEvaluationState = ({
  project,
  experiment,
  selectedRunId,
  setSelectedRunId,
}: {
  project?: Project;
  experiment?: Experiment;
  selectedRunId?: string;
  setSelectedRunId?: (runId: string) => void;
}) => {
  const [isSomeRunning, setIsSomeRunning] = useState(false);
  const [keepFetching, setKeepFetching] = useState(false);

  const batchEvaluationRuns =
    api.experiments.getExperimentBatchEvaluationRuns.useQuery(
      {
        projectId: project?.id ?? "",
        experimentId: experiment?.id ?? "",
      },
      {
        refetchInterval: keepFetching ? 1 : isSomeRunning ? 3000 : 10_000,
        enabled: !!project && !!experiment,
      }
    );

  const router = useRouter();

  const { selectedRunId_, selectedRun } = useMemo(() => {
    const selectedRunId_ =
      selectedRunId ??
      (typeof router.query.runId === "string" ? router.query.runId : null) ??
      batchEvaluationRuns.data?.runs[0]?.run_id;
    const selectedRun = batchEvaluationRuns.data?.runs.find(
      (r) => r.run_id === selectedRunId_
    );
    return { selectedRunId_, selectedRun };
  }, [selectedRunId, router.query.runId, batchEvaluationRuns.data?.runs]);

  useEffect(() => {
    if (selectedRunId && !selectedRun) {
      setKeepFetching(true);
      setTimeout(() => {
        setKeepFetching(false);
      }, 5_000);
    } else {
      setKeepFetching(false);
    }
  }, [batchEvaluationRuns.data?.runs, selectedRunId, selectedRun]);

  const setSelectedRunId_ = useCallback(
    (runId: string) => {
      if (setSelectedRunId) {
        setSelectedRunId(runId);
      } else {
        void router.push({ query: { ...router.query, runId } });
      }
    },
    [router, setSelectedRunId]
  );

  const isFinished = useMemo(() => {
    if (!selectedRun) {
      return false;
    }
    return (
      getFinishedAt(selectedRun.timestamps, new Date().getTime()) !== undefined
    );
  }, [selectedRun]);

  useEffect(() => {
    if (
      batchEvaluationRuns.data?.runs.some(
        (r) => getFinishedAt(r.timestamps, new Date().getTime()) === undefined
      )
    ) {
      setIsSomeRunning(true);
    } else {
      setIsSomeRunning(false);
    }
  }, [batchEvaluationRuns.data?.runs]);

  return {
    batchEvaluationRuns,
    selectedRun,
    selectedRunId: selectedRunId_,
    setSelectedRunId: setSelectedRunId_,
    isFinished,
  };
};

export function BatchEvaluationV2RunList({
  batchEvaluationRuns,
  selectedRun,
  selectedRunId,
  setSelectedRunId,
  size = "md",
  ...props
}: {
  batchEvaluationRuns: UseTRPCQueryResult<
    inferRouterOutputs<AppRouter>["experiments"]["getExperimentBatchEvaluationRuns"],
    TRPCClientErrorLike<AppRouter>
  >;
  selectedRun:
    | NonNullable<
        UseTRPCQueryResult<
          inferRouterOutputs<AppRouter>["experiments"]["getExperimentBatchEvaluationRuns"],
          TRPCClientErrorLike<AppRouter>
        >["data"]
      >["runs"][number]
    | undefined;
  selectedRunId: string | undefined;
  setSelectedRunId: (runId: string) => void;
  size?: "sm" | "md";
} & StackProps) {
  const hasAnyVersion = batchEvaluationRuns.data?.runs.some(
    (run) => run.workflow_version
  );

  return (
    <VStack
      align="start"
      background="white"
      paddingY={size === "sm" ? 0 : 4}
      borderRightWidth="1px"
      borderColor="gray.300"
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
      {batchEvaluationRuns.isLoading ? (
        <>
          {Array.from({ length: 3 }).map((_, index) => (
            <HStack key={index} paddingX={6} paddingY={2} width="100%">
              <Skeleton width="100%" height="30px" />
            </HStack>
          ))}
        </>
      ) : batchEvaluationRuns.error ? (
        <Alert.Root status="error">
          <Alert.Indicator />
          Error loading experiment runs
        </Alert.Root>
      ) : batchEvaluationRuns.data?.runs.length === 0 ? (
        <Text paddingX={6} paddingY={4}>
          Waiting for runs...
        </Text>
      ) : (
        <>
          {!batchEvaluationRuns.data?.runs.find(
            (r) => r.run_id === selectedRunId
          ) && (
            <HStack
              paddingX={size === "sm" ? 2 : 4}
              paddingY={size === "sm" ? 2 : 3}
              width="100%"
              cursor="pointer"
              role="button"
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
          {batchEvaluationRuns.data?.runs.map((run) => {
            const runCost =
              (run.summary.dataset_cost ?? 0) +
              (run.summary.evaluations_cost ?? 0);
            const runName = run.workflow_version?.commitMessage ?? run.run_id;

            return (
              <HStack
                key={run?.run_id ?? "new"}
                paddingX={size === "sm" ? 2 : 4}
                paddingY={size === "sm" ? 2 : 3}
                width="100%"
                cursor="pointer"
                role="button"
                background={
                  selectedRun?.run_id === run.run_id ? "gray.200" : "none"
                }
                _hover={{
                  background:
                    selectedRun?.run_id === run.run_id
                      ? "gray.200"
                      : "gray.100",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedRunId(run.run_id);
                }}
                gap={3}
              >
                {run.workflow_version ? (
                  <VersionBox
                    version={run.workflow_version}
                    minWidth={hasAnyVersion ? "48px" : "0"}
                  />
                ) : (
                  <VersionBox
                    minWidth={hasAnyVersion ? "48px" : "0"}
                    backgroundColor={
                      run.timestamps.stopped_at
                        ? "red.200"
                        : getColorForString("colors", run.run_id).color
                    }
                  />
                )}
                <VStack align="start" gap={0}>
                  <Text
                    fontSize={size === "sm" ? "13px" : "14px"}
                    lineClamp={1}
                    wordBreak="break-all"
                  >
                    {runName}
                    {getFinishedAt(run.timestamps, new Date().getTime()) ===
                      undefined && (
                      <Spinner
                        size="xs"
                        display="inline-block"
                        marginLeft={2}
                        marginBottom="-2px"
                      />
                    )}
                  </Text>
                  <HStack
                    color="gray.400"
                    fontSize={size === "sm" ? "12px" : "13px"}
                    gap={1}
                  >
                    {Object.values(run.summary.evaluations)
                      .slice(0, 2)
                      .map((evaluation, index) => (
                        <React.Fragment key={evaluation.name}>
                          {index > 0 && <Text>·</Text>}
                          <Tooltip
                            content={evaluation.name}
                            positioning={{ placement: "top" }}
                          >
                            <Text>
                              {formatEvaluationSummary(evaluation, true)}
                            </Text>
                          </Tooltip>
                        </React.Fragment>
                      ))}
                    {!!runCost && (
                      <>
                        {Object.keys(run.summary.evaluations).length > 0 && (
                          <Text>·</Text>
                        )}
                        <Text whiteSpace="nowrap">
                          <FormatMoney
                            amount={runCost}
                            currency="USD"
                            format="$0.00[0]"
                          />
                        </Text>
                      </>
                    )}
                  </HStack>
                  <HStack
                    color="gray.400"
                    fontSize={size === "sm" ? "12px" : "13px"}
                  >
                    <Text whiteSpace="nowrap" lineClamp={1}>
                      {run.timestamps.created_at
                        ? formatTimeAgo(
                            run.timestamps.created_at,
                            "yyyy-MM-dd HH:mm",
                            5
                          )
                        : "Waiting for steps..."}
                    </Text>
                    {run.timestamps.stopped_at && (
                      <Box
                        width="6px"
                        height="6px"
                        background="red.300"
                        borderRadius="full"
                      />
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
