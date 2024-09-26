import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  Divider,
  HStack,
  Heading,
  Skeleton,
  Spacer,
  Spinner,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Table,
  TableContainer,
  Tabs,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
} from "@chakra-ui/react";
import type { Experiment, Project } from "@prisma/client";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink } from "react-feather";
import { FormatMoney } from "../../optimization_studio/components/FormatMoney";
import { VersionBox } from "../../optimization_studio/components/History";
import type { ESBatchEvaluation } from "../../server/experiments/types";
import { api } from "../../utils/api";
import { formatMilliseconds } from "../../utils/formatMilliseconds";
import { formatTimeAgo } from "../../utils/formatTimeAgo";
import { getColorForString } from "../../utils/rotatingColors";
import { HoverableBigText } from "../HoverableBigText";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../server/api/root";
import numeral from "numeral";
import React from "react";

export function BatchEvaluationV2({
  project,
  experiment,
}: {
  project: Project;
  experiment: Experiment;
}) {
  const { batchEvaluationRuns, selectedRun, setSelectedRunId, isFinished } =
    useBatchEvaluationState({
      project,
      experiment,
    });

  return (
    <HStack align="start" width="full" height="full" spacing={0}>
      <BatchEvaluationV2RunList
        batchEvaluationRuns={batchEvaluationRuns}
        selectedRun={selectedRun}
        setSelectedRunId={setSelectedRunId}
      />
      <Box width="calc(100vw - 398px)" height="full" position="relative">
        <VStack
          align="start"
          width="full"
          height="full"
          spacing={8}
          padding={6}
        >
          <HStack width="full" align="end" spacing={6}>
            <Heading as="h1" size="lg">
              {experiment.name ?? experiment.slug}
            </Heading>
            <Spacer />
            {experiment.workflowId && (
              <Button
                as={"a"}
                size="sm"
                target="_blank"
                href={`/${project.slug}/studio/${experiment.workflowId}`}
                leftIcon={<ExternalLink size={16} />}
                textDecoration="none"
                marginBottom="-6px"
                colorScheme="orange"
              >
                Open Workflow
              </Button>
            )}
          </HStack>
          {batchEvaluationRuns.isLoading ||
          (batchEvaluationRuns.error &&
            batchEvaluationRuns.error.data?.httpStatus == 404) ? (
            <Skeleton width="100%" height="30px" />
          ) : batchEvaluationRuns.error ? (
            <Alert status="error">
              <AlertIcon />
              Error loading experiment runs
            </Alert>
          ) : batchEvaluationRuns.data?.runs.length === 0 ? (
            <Text>Waiting for results...</Text>
          ) : (
            selectedRun && (
              <>
                <Card width="100%">
                  <CardHeader>
                    <Heading as="h2" size="md">
                      {selectedRun.workflow_version?.commitMessage ??
                        "Evaluation Results"}
                    </Heading>
                  </CardHeader>
                  <CardBody paddingTop={0}>
                    <BatchEvaluationV2EvaluationResults
                      project={project}
                      experiment={experiment}
                      runId={selectedRun.run_id}
                      total={selectedRun.total ?? undefined}
                      isFinished={isFinished}
                    />
                  </CardBody>
                </Card>
              </>
            )
          )}
        </VStack>
        {selectedRun && (
          <BatchEvaluationV2EvaluationSummary run={selectedRun} />
        )}
      </Box>
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
        experimentSlug: experiment?.slug ?? "",
      },
      {
        refetchInterval: keepFetching ? 1 : isSomeRunning ? 3000 : false,
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
  setSelectedRunId,
  size = "md",
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
  setSelectedRunId: (runId: string) => void;
  size?: "sm" | "md";
}) {
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
      spacing={0}
      overflowY="auto"
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
        <Alert status="error">
          <AlertIcon />
          Error loading experiment runs
        </Alert>
      ) : batchEvaluationRuns.data?.runs.length === 0 ? (
        <Text paddingX={6} paddingY={4}>
          Waiting for runs...
        </Text>
      ) : (
        batchEvaluationRuns.data?.runs.map((run) => {
          const runCost = run.summary.cost;
          const runName = run.workflow_version?.commitMessage ?? run.run_id;

          return (
            <HStack
              key={run?.run_id ?? "new"}
              paddingX={size === "sm" ? 2 : 6}
              paddingY={size === "sm" ? 2 : 4}
              width="100%"
              cursor="pointer"
              role="button"
              background={
                selectedRun?.run_id === run.run_id ? "gray.200" : "none"
              }
              _hover={{
                background:
                  selectedRun?.run_id === run.run_id ? "gray.200" : "gray.100",
              }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedRunId(run.run_id);
              }}
              spacing={3}
            >
              {run.workflow_version ? (
                <VersionBox version={run.workflow_version} />
              ) : (
                <Box
                  width="24px"
                  height="24px"
                  minWidth="24px"
                  minHeight="24px"
                  background="gray.300"
                  borderRadius="100%"
                  backgroundColor={
                    getColorForString("colors", run.run_id).color
                  }
                />
              )}
              <VStack align="start" spacing={0}>
                <Text fontSize={size === "sm" ? "13px" : "14px"}>
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
                >
                  {runCost && (
                    <>
                      {/* <Text>·</Text> */}
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
                  <Text whiteSpace="nowrap" noOfLines={1}>
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
        })
      )}
    </VStack>
  );
}

export const BatchEvaluationV2EvaluationResults = React.memo(
  function BatchEvaluationV2EvaluationResults({
    project,
    experiment,
    runId,
    isFinished,
    size = "md",
  }: {
    project: Project;
    experiment: Experiment;
    runId: string | undefined;
    isFinished: boolean;
    size?: "sm" | "md";
  }) {
    const [keepRefetching, setKeepRefetching] = useState(true);

    const run = api.experiments.getExperimentBatchEvaluationRun.useQuery(
      {
        projectId: project.id,
        experimentSlug: experiment.slug,
        runId: runId ?? "",
      },
      {
        enabled: !!runId,
        refetchInterval: keepRefetching ? 1000 : false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      }
    );

    useEffect(() => {
      if (isFinished) {
        setTimeout(() => {
          setKeepRefetching(false);
        }, 2_000);
      } else {
        setKeepRefetching(true);
      }
    }, [isFinished]);

    const datasetByIndex = run.data?.dataset.reduce(
      (acc, item) => {
        acc[item.index] = item;
        return acc;
      },
      {} as Record<number, ESBatchEvaluation["dataset"][number]>
    );

    const resultsByEvaluator = run.data?.evaluations.reduce(
      (acc, evaluation) => {
        if (!acc[evaluation.evaluator]) {
          acc[evaluation.evaluator] = [];
        }
        acc[evaluation.evaluator]!.push(evaluation);
        return acc;
      },
      {} as Record<string, ESBatchEvaluation["evaluations"]>
    );

    const [hasScrolled, setHasScrolled] = useState(false);

    if (run.error) {
      return (
        <Alert status="error">
          <AlertIcon />
          Error loading evaluation results
        </Alert>
      );
    }

    if (!resultsByEvaluator || !datasetByIndex) {
      return (
        <VStack spacing={0} width="full" height="full" minWidth="0">
          <Tabs
            size={size}
            width="full"
            height="full"
            display="flex"
            flexDirection="column"
            minHeight="0"
            overflowX="auto"
            padding={0}
          >
            <TabList>
              <Tab>
                <Skeleton width="60px" height="22px" />
              </Tab>
            </TabList>
            <TabPanels
              minWidth="full"
              minHeight="0"
              overflowY="auto"
              onScroll={() => setHasScrolled(true)}
            >
              <TabPanel padding={0}>
                <Table size={size === "sm" ? "xs" : "sm"} variant="grid">
                  <Thead>
                    <Tr>
                      <Th rowSpan={2} width="50px">
                        <Skeleton width="100%" height="52px" />
                      </Th>
                      <Th>
                        <Skeleton width="100%" height="18px" />
                      </Th>
                      <Th>
                        <Skeleton width="100%" height="18px" />
                      </Th>
                      <Th>
                        <Skeleton width="100%" height="18px" />
                      </Th>
                    </Tr>
                    <Tr>
                      <Th>
                        <Skeleton width="100%" height="18px" />
                      </Th>
                      <Th>
                        <Skeleton width="100%" height="18px" />
                      </Th>
                      <Th>
                        <Skeleton width="100%" height="18px" />
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    <Tr>
                      <Td>
                        <Skeleton width="100%" height="18px" />
                      </Td>
                      <Td>
                        <Skeleton width="100%" height="18px" />
                      </Td>
                      <Td>
                        <Skeleton width="100%" height="18px" />
                      </Td>
                      <Td>
                        <Skeleton width="100%" height="18px" />
                      </Td>
                    </Tr>
                  </Tbody>
                </Table>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </VStack>
      );
    }

    const datasetColumns = new Set(
      Object.values(datasetByIndex).flatMap((item) =>
        Object.keys(item.entry ?? {})
      )
    );

    return (
      <Tabs
        size={size}
        width="full"
        height="full"
        display="flex"
        flexDirection="column"
        minHeight="0"
        overflowX="auto"
        position="relative"
      >
        <Box
          position="absolute"
          top={1}
          right={2}
          color="gray.400"
          fontSize="12px"
        >
          {runId}
        </Box>
        <TabList>
          {Object.entries(resultsByEvaluator).map(([evaluator, results]) => (
            <Tab key={evaluator}>
              {results.find((r) => r.name)?.name ?? evaluator}
            </Tab>
          ))}
        </TabList>
        <TabPanels minWidth="full" minHeight="0" overflowY="auto">
          {Object.entries(resultsByEvaluator).map(([evaluator, results]) => {
            return (
              <TabPanel
                key={evaluator}
                padding={0}
                minWidth="full"
                width="fit-content"
                minHeight="0"
              >
                <BatchEvaluationV2EvaluationResult
                  results={results}
                  datasetByIndex={datasetByIndex}
                  datasetColumns={datasetColumns}
                  isFinished={isFinished}
                  size={size}
                  hasScrolled={hasScrolled}
                />
              </TabPanel>
            );
          })}
        </TabPanels>
      </Tabs>
    );
  }
);

export function BatchEvaluationV2EvaluationResult({
  results,
  datasetByIndex,
  datasetColumns,
  isFinished,
  size = "md",
  hasScrolled,
}: {
  results: ESBatchEvaluation["evaluations"];
  datasetByIndex: Record<number, ESBatchEvaluation["dataset"][number]>;
  datasetColumns: Set<string>;
  isFinished: boolean;
  size?: "sm" | "md";
  hasScrolled: boolean;
}) {
  const evaluationInputsColumns = new Set(
    results.flatMap((result) => Object.keys(result.inputs ?? {}))
  );
  const evaluatorResultsColumnsMap = {
    passed: false,
    score: false,
    label: false,
    details: false,
  };
  for (const result of results) {
    if (result.score !== undefined && result.score !== null) {
      evaluatorResultsColumnsMap.score = true;
    }
    if (result.passed !== undefined && result.passed !== null) {
      evaluatorResultsColumnsMap.passed = true;
    }
    if (result.label !== undefined && result.label !== null) {
      evaluatorResultsColumnsMap.label = true;
    }
    if (result.details !== undefined && result.details !== null) {
      evaluatorResultsColumnsMap.details = true;
    }
  }
  const evaluationResultsColumns = new Set(
    Object.entries(evaluatorResultsColumnsMap)
      .filter(([_key, value]) => value)
      .map(([key]) => key)
  );

  const totalRows = Math.max(...results.map((r) => r.index + 1));

  // Scroll to the bottom on rerender if component was at the bottom previously
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;

    return () => {
      let isAtBottom = true;
      const scrollParent = container?.parentElement?.parentElement;
      if (scrollParent) {
        const currentScrollTop = scrollParent.scrollTop;
        const scrollParentHeight = scrollParent.clientHeight;

        isAtBottom =
          currentScrollTop + scrollParentHeight + 32 >=
          scrollParent.scrollHeight;
      }

      if (isAtBottom || (!hasScrolled && !isFinished)) {
        setTimeout(() => {
          if (!containerRef.current || hasScrolled) return;
          scrollParent?.scrollTo({
            // eslint-disable-next-line react-hooks/exhaustive-deps
            top: containerRef.current.scrollHeight,
            behavior: "smooth",
          });
        }, 100);
        setTimeout(() => {
          if (!containerRef.current || hasScrolled) return;
          scrollParent?.scrollTo({
            // eslint-disable-next-line react-hooks/exhaustive-deps
            top: containerRef.current.scrollHeight,
            behavior: "smooth",
          });
        }, 1000);
      }
    };
  }, [results, isFinished, hasScrolled]);

  return (
    <TableContainer ref={containerRef}>
      <Table size={size === "sm" ? "xs" : "sm"} variant="grid">
        <Thead>
          <Tr>
            <Th width="35px" rowSpan={2}></Th>

            <Th colSpan={datasetColumns.size} paddingY={2}>
              <Text>Dataset</Text>
            </Th>

            <Th colSpan={evaluationInputsColumns.size} paddingY={2}>
              <Text>Evaluation Entry</Text>
            </Th>

            <Th rowSpan={2}>Cost</Th>
            <Th rowSpan={2}>Duration</Th>

            {Array.from(evaluationResultsColumns).map((column) => (
              <Th key={`evaluation-result-${column}`} rowSpan={2}>
                {column}
              </Th>
            ))}
          </Tr>
          <Tr>
            {Array.from(datasetColumns).map((column) => (
              <Th key={`dataset-${column}`} paddingY={2}>
                {column}
              </Th>
            ))}
            {Array.from(evaluationInputsColumns).map((column) => (
              <Th key={`evaluation-entry-${column}`} paddingY={2}>
                {column}
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {Array.from({ length: totalRows }).map((_, index) => {
            const evaluation = results.find((r) => r.index === index);
            const datasetEntry = datasetByIndex[index];

            return (
              <Tr key={index}>
                <Td width="35px">{index + 1}</Td>

                {Array.from(datasetColumns).map((column) => (
                  <Td key={`dataset-${column}`} maxWidth="250px">
                    {datasetEntry ? (
                      <HoverableBigText>
                        {datasetEntry.entry[column] ?? "-"}
                      </HoverableBigText>
                    ) : (
                      "-"
                    )}
                  </Td>
                ))}

                {Array.from(evaluationInputsColumns).map((column) => (
                  <Td key={`evaluation-entry-${column}`} maxWidth="250px">
                    {evaluation ? (
                      <HoverableBigText>
                        {evaluation.inputs[column] ?? "-"}
                      </HoverableBigText>
                    ) : (
                      "-"
                    )}
                  </Td>
                ))}

                <Td>
                  {datasetEntry?.cost ? (
                    <FormatMoney
                      amount={datasetEntry?.cost ?? 0}
                      currency="USD"
                      format="$0.00[00]"
                    />
                  ) : (
                    "-"
                  )}
                </Td>
                <Td>
                  {datasetEntry?.duration
                    ? formatMilliseconds(datasetEntry.duration)
                    : "-"}
                </Td>

                {Array.from(evaluationResultsColumns).map((column) => {
                  const value = (
                    evaluation as Record<string, any> | undefined
                  )?.[column];
                  return (
                    <Td
                      key={`evaluation-result-${column}`}
                      background={
                        value === false
                          ? "red.100"
                          : value === true
                          ? "green.100"
                          : "none"
                      }
                    >
                      {value === false
                        ? "false"
                        : value === true
                        ? "true"
                        : value ?? "-"}
                    </Td>
                  );
                })}
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </TableContainer>
  );
}

const getFinishedAt = (
  timestamps: ESBatchEvaluation["timestamps"],
  currentTimestamp: number
) => {
  if (timestamps.finished_at) {
    return timestamps.finished_at;
  }
  if (
    currentTimestamp - new Date(timestamps.updated_at).getTime() >
    2 * 60 * 1000
  ) {
    return new Date(timestamps.updated_at).getTime();
  }
  return undefined;
};

export function BatchEvaluationV2EvaluationSummary({
  run,
}: {
  run: NonNullable<
    UseTRPCQueryResult<
      inferRouterOutputs<AppRouter>["experiments"]["getExperimentBatchEvaluationRuns"],
      TRPCClientErrorLike<AppRouter>
    >["data"]
  >["runs"][number];
}) {
  const [currentTimestamp, setCurrentTimestamp] = useState(0);
  const finishedAt = useMemo(() => {
    return getFinishedAt(run.timestamps, currentTimestamp);
  }, [run.timestamps, currentTimestamp]);

  const runtime = Math.max(
    run.timestamps.created_at
      ? (finishedAt ?? currentTimestamp) -
          new Date(run.timestamps.created_at).getTime()
      : 0,
    0
  );

  useEffect(() => {
    if (finishedAt) return;

    const interval = setInterval(() => {
      setCurrentTimestamp(new Date().getTime());
    }, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!finishedAt]);

  return (
    <HStack
      position="sticky"
      left={0}
      bottom={0}
      width="100%"
      background="white"
      borderTop="1px solid"
      borderColor="gray.200"
      paddingY={4}
      paddingX={6}
      spacing={5}
    >
      {Object.entries(run.summary.evaluations).map(([_, evaluation]) => {
        return (
          <>
            <VStack align="start" spacing={1}>
              <Text fontWeight="500">{evaluation.name}</Text>
              <Text>
                {evaluation.average_passed ? (
                  <>
                    {numeral(evaluation.average_passed).format("0.[0]%")}{" "}
                    {evaluation.average_passed == evaluation.average_score
                      ? "pass"
                      : `(${numeral(evaluation.average_score).format(
                          "0.[00]"
                        )})`}
                  </>
                ) : (
                  <>{numeral(evaluation.average_score).format("0.[00]")}</>
                )}
              </Text>
            </VStack>
            <Divider orientation="vertical" height="48px" />
          </>
        );
      })}
      <VStack align="start" spacing={1}>
        <Text fontWeight="500" noOfLines={1}>
          Mean Cost
        </Text>
        <Text noOfLines={1} whiteSpace="nowrap">
          <FormatMoney
            amount={run.summary.dataset_average_cost}
            currency="USD"
            format="$0.00[00]"
          />
        </Text>
      </VStack>
      <Divider orientation="vertical" height="48px" />
      <VStack align="start" spacing={1}>
        <Text fontWeight="500" noOfLines={1}>
          Mean Duration
        </Text>
        <Text>{formatMilliseconds(run.summary.dataset_average_duration)}</Text>
      </VStack>
      <Divider orientation="vertical" height="48px" />
      <VStack align="start" spacing={1}>
        <Text fontWeight="500" noOfLines={1}>
          Total Cost
        </Text>
        <Text noOfLines={1} whiteSpace="nowrap">
          <FormatMoney
            amount={run.summary.cost}
            currency="USD"
            format="$0.00[00]"
          />
        </Text>
      </VStack>
      <Divider orientation="vertical" height="48px" />
      <VStack align="start" spacing={1}>
        <Text fontWeight="500" noOfLines={1}>
          Runtime
        </Text>
        <Text noOfLines={1} whiteSpace="nowrap">
          {numeral(runtime / 1000).format("00:00:00")}
        </Text>
      </VStack>
      {run.timestamps.stopped_at && (
        <>
          <Spacer />
          <HStack>
            <Box
              width="12px"
              height="12px"
              background="red.500"
              borderRadius="full"
            />
            <Text>Stopped</Text>
          </HStack>
        </>
      )}
    </HStack>
  );
}
