import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  HStack,
  Heading,
  Skeleton,
  Spacer,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  TableContainer,
  Table,
  Tabs,
  Tbody,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
  Td,
  Tooltip,
} from "@chakra-ui/react";
import type { Experiment, Project } from "@prisma/client";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink } from "react-feather";
import { VersionBox } from "../../optimization_studio/components/History";
import { api } from "../../utils/api";
import { formatMoney } from "../../utils/formatMoney";
import { formatTimeAgo } from "../../utils/formatTimeAgo";
import { getColorForString } from "../../utils/rotatingColors";
import type { ESBatchEvaluation } from "../../server/experiments/types";
import { formatMilliseconds } from "../../utils/formatMilliseconds";

export function BatchEvaluationV2({
  project,
  experiment,
}: {
  project: Project;
  experiment: Experiment;
}) {
  const { batchEvaluationRuns, selectedRun } = useBatchEvaluationState({
    project,
    experiment,
  });

  return (
    <HStack align="start" width="full" height="full">
      <BatchEvaluationV2RunList project={project} experiment={experiment} />
      <VStack align="start" width="calc(100vw - 398px)" spacing={8} padding={6}>
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
        {batchEvaluationRuns.isLoading ? (
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
                  <HStack width="full">
                    <Heading as="h2" size="md">
                      {selectedRun.workflow_version?.commitMessage ??
                        "Evaluation Results"}
                    </Heading>
                    <Spacer />
                    <Text fontSize="13" color="gray.400">
                      {selectedRun.run_id}
                    </Text>
                  </HStack>
                </CardHeader>
                <CardBody paddingTop={0}>
                  <BatchEvaluationV2EvaluationResults
                    project={project}
                    experiment={experiment}
                    runId={selectedRun.run_id}
                  />
                </CardBody>
              </Card>
            </>
          )
        )}
      </VStack>
    </HStack>
  );
}

const useBatchEvaluationState = ({
  project,
  experiment,
}: {
  project: Project;
  experiment: Experiment;
}) => {
  const batchEvaluationRuns =
    api.experiments.getExperimentBatchEvaluationRuns.useQuery(
      {
        projectId: project.id,
        experimentSlug: experiment.slug,
      },
      {
        refetchInterval: 3000,
        refetchOnMount: false,
      }
    );

  const router = useRouter();

  const selectedRunIdFromQuery =
    typeof router.query.runId === "string" ? router.query.runId : null;

  const selectedRun = useMemo(() => {
    return (
      batchEvaluationRuns.data?.runs.find(
        (r) => r.run_id === selectedRunIdFromQuery
      ) ?? batchEvaluationRuns.data?.runs[0]
    );
  }, [batchEvaluationRuns.data?.runs, selectedRunIdFromQuery]);

  const setSelectedRunId = useCallback(
    (runId: string) => {
      void router.push({ query: { ...router.query, runId } });
    },
    [router]
  );

  return { batchEvaluationRuns, selectedRun, setSelectedRunId };
};

function BatchEvaluationV2RunList({
  project,
  experiment,
}: {
  project: Project;
  experiment: Experiment;
}) {
  const { batchEvaluationRuns, selectedRun, setSelectedRunId } =
    useBatchEvaluationState({
      project,
      experiment,
    });

  return (
    <VStack
      align="start"
      background="white"
      paddingY={4}
      borderRightWidth="1px"
      borderColor="gray.300"
      fontSize="14px"
      minWidth="300px"
      height="full"
      spacing={0}
    >
      <Heading as="h2" size="md" paddingX={6} paddingY={4}>
        Evaluation Runs
      </Heading>
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
              paddingX={6}
              paddingY={4}
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
                <Text>{runName}</Text>
                <HStack color="gray.400" fontSize="13px">
                  {runCost && (
                    <>
                      {/* <Text>·</Text> */}
                      <Text whiteSpace="nowrap">
                        {formatMoney(
                          { amount: runCost, currency: "USD" },
                          "$0.00[0]"
                        )}
                      </Text>
                    </>
                  )}
                </HStack>
                <HStack color="gray.400" fontSize="13px">
                  <Text whiteSpace="nowrap" noOfLines={1}>
                    {run.created_at
                      ? formatTimeAgo(run.created_at, "yyyy-MM-dd HH:mm", 5)
                      : "Waiting for steps..."}
                  </Text>
                </HStack>
              </VStack>
            </HStack>
          );
        })
      )}
    </VStack>
  );
}

export function BatchEvaluationV2EvaluationResults({
  project,
  experiment,
  runId,
}: {
  project: Project;
  experiment: Experiment;
  runId: string;
}) {
  const run = api.experiments.getExperimentBatchEvaluationRun.useQuery({
    projectId: project.id,
    experimentSlug: experiment.slug,
    runId,
  });

  const datasetByIndex = run.data?.dataset.reduce(
    (acc, item, index) => {
      acc[index] = item;
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

  if (run.error) {
    return (
      <Alert status="error">
        <AlertIcon />
        Error loading evaluation results
      </Alert>
    );
  }

  if (!resultsByEvaluator || !datasetByIndex) {
    return <Skeleton width="100%" height="30px" />;
  }

  const datasetColumns = new Set(
    Object.values(datasetByIndex).flatMap((item) =>
      Object.keys(item.entry ?? {})
    )
  );

  return (
    <Tabs>
      <TabList>
        {Object.entries(resultsByEvaluator).map(([evaluator, results]) => (
          <Tab key={evaluator}>
            {results.find((r) => r.name)?.name ?? evaluator}
          </Tab>
        ))}
      </TabList>
      <TabPanels>
        {Object.entries(resultsByEvaluator).map(([evaluator, results]) => {
          return (
            <TabPanel key={evaluator} padding={0}>
              <BatchEvaluationV2EvaluationResult
                results={results}
                datasetByIndex={datasetByIndex}
                datasetColumns={datasetColumns}
              />
            </TabPanel>
          );
        })}
      </TabPanels>
    </Tabs>
  );
}

export function BatchEvaluationV2EvaluationResult({
  results,
  datasetByIndex,
  datasetColumns,
}: {
  results: ESBatchEvaluation["evaluations"];
  datasetByIndex: Record<number, ESBatchEvaluation["dataset"][number]>;
  datasetColumns: Set<string>;
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
    if (result.score) {
      evaluatorResultsColumnsMap.score = true;
    }
    if (result.passed) {
      evaluatorResultsColumnsMap.passed = true;
    }
    if (result.label) {
      evaluatorResultsColumnsMap.label = true;
    }
    if (result.details) {
      evaluatorResultsColumnsMap.details = true;
    }
  }
  const evaluationResultsColumns = new Set(
    Object.entries(evaluatorResultsColumnsMap)
      .filter(([_key, value]) => value)
      .map(([key]) => key)
  );

  return (
    <TableContainer>
      <Table size="sm" variant="grid">
        <Thead>
          <Tr>
            <Th width="35px" paddingY={3} rowSpan={2}></Th>

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
          {results
            .sort((a, b) => a.index - b.index)
            .map((evaluation) => {
              const datasetEntry = datasetByIndex[evaluation.index];

              return (
                <Tr key={evaluation.index}>
                  <Td width="35px" paddingY={3}>
                    {evaluation.index + 1}
                  </Td>

                  {Array.from(datasetColumns).map((column) => (
                    <Td key={`dataset-${column}`} maxWidth="250px">
                      <HoverableBigText>
                        {datasetEntry?.entry[column] ?? "-"}
                      </HoverableBigText>
                    </Td>
                  ))}

                  {Array.from(evaluationInputsColumns).map((column) => (
                    <Td key={`evaluation-entry-${column}`} maxWidth="250px">
                      <HoverableBigText>
                        {evaluation.inputs[column] ?? "-"}
                      </HoverableBigText>
                    </Td>
                  ))}

                  <Td>
                    {datasetEntry?.cost
                      ? formatMoney(
                          {
                            amount: datasetEntry?.cost ?? 0,
                            currency: "USD",
                          },
                          "$0.00[00]"
                        )
                      : "-"}
                  </Td>
                  <Td>
                    {datasetEntry?.duration
                      ? formatMilliseconds(datasetEntry.duration)
                      : "-"}
                  </Td>

                  {Array.from(evaluationResultsColumns).map((column) => {
                    const value = (evaluation as any)[column];
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

export function HoverableBigText({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOverflown, setIsOverflown] = useState(false);

  useEffect(() => {
    const element = ref.current!;

    const checkOverflow = () => {
      setIsOverflown(
        element
          ? Math.abs(element.offsetWidth - element.scrollWidth) > 2 ||
              Math.abs(element.offsetHeight - element.scrollHeight) > 2
          : false
      );
    };

    checkOverflow();
    window.addEventListener("resize", checkOverflow);

    return () => {
      window.removeEventListener("resize", checkOverflow);
    };
  }, []);

  return (
    <Tooltip
      isDisabled={!isOverflown}
      label={<Box whiteSpace="pre-wrap">{children}</Box>}
    >
      <Box
        ref={ref}
        width="full"
        height="full"
        whiteSpace="normal"
        noOfLines={7}
      >
        {children}
      </Box>
    </Tooltip>
  );
}
