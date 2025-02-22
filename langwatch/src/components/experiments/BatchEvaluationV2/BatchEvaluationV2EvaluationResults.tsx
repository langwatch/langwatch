import {
  Alert,
  AlertIcon,
  HStack,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Skeleton,
  Spacer,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Table,
  Tabs,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
  useToast,
} from "@chakra-ui/react";
import type { Experiment, Project } from "@prisma/client";
import Parse from "papaparse";
import React, { useEffect, useState } from "react";
import { Download, ExternalLink, MoreVertical } from "react-feather";
import type { ESBatchEvaluation } from "../../../server/experiments/types";
import { api } from "../../../utils/api";
import {
  BatchEvaluationV2EvaluationResult,
  evaluationResultsTableData,
} from "./BatchEvaluationV2EvaluationResult";

export const useBatchEvaluationResults = ({
  project,
  experiment,
  runId,
  isFinished,
}: {
  project: Project;
  experiment: Experiment;
  runId: string | undefined;
  isFinished: boolean;
}) => {
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

  const datasetColumns = new Set(
    Object.values(datasetByIndex ?? {}).flatMap((item) =>
      Object.keys(item.entry ?? {})
    )
  );

  const predictedColumns = new Set(
    Object.values(datasetByIndex ?? {}).flatMap((item) =>
      Object.keys(item.predicted ?? {})
    )
  );

  let resultsByEvaluator = run.data?.evaluations.reduce(
    (acc, evaluation) => {
      if (!acc[evaluation.evaluator]) {
        acc[evaluation.evaluator] = [];
      }
      acc[evaluation.evaluator]!.push(evaluation);
      return acc;
    },
    {} as Record<string, ESBatchEvaluation["evaluations"]>
  );

  resultsByEvaluator = Object.fromEntries(
    Object.entries(resultsByEvaluator ?? {}).sort((a, b) =>
      a[0].localeCompare(b[0])
    )
  );

  if (
    Object.keys(resultsByEvaluator ?? {}).length === 0 &&
    (run.data?.dataset.length ?? 0) > 0
  ) {
    resultsByEvaluator = {
      Predictions: [],
    };
  }

  return {
    run,
    datasetByIndex,
    datasetColumns,
    predictedColumns,
    resultsByEvaluator,
  };
};

export const useBatchEvaluationDownloadCSV = ({
  project,
  experiment,
  runId,
  isFinished,
}: {
  project: Project;
  experiment: Experiment;
  runId: string | undefined;
  isFinished: boolean;
}) => {
  const toast = useToast();

  const {
    run,
    datasetByIndex,
    datasetColumns,
    predictedColumns,
    resultsByEvaluator,
  } = useBatchEvaluationResults({
    project,
    experiment,
    runId,
    isFinished,
  });

  const downloadCSV = async () => {
    try {
      await downloadCSV_();
    } catch (error) {
      toast({
        title: "Error Downloading CSV",
        status: "error",
        description: (error as any).toString(),
        duration: null,
      });
      console.error(error);
    }
  };

  const isDownloadCSVEnabled = !!runId && !!run.data && !!datasetByIndex;

  const downloadCSV_ = async () => {
    if (!isDownloadCSVEnabled) {
      throw new Error("Results not loaded yet");
    }

    const tableData = evaluationResultsTableData(
      resultsByEvaluator,
      datasetByIndex,
      datasetColumns,
      predictedColumns
    );

    const csvHeaders = [
      ...Array.from(tableData.headers.datasetColumns),
      ...Array.from(tableData.headers.predictedColumns).map((c) =>
        tableData.headers.datasetColumns.has(c) ? `predicted_${c}` : c
      ),
      tableData.headers.cost,
      tableData.headers.duration,
      ...Object.entries(tableData.headers.evaluationColumns).flatMap(
        ([
          evaluator,
          { evaluationInputsColumns, evaluationResultsColumns },
        ]) => [
          ...Array.from(evaluationInputsColumns).map(
            (c) => `${evaluator} ${c}`
          ),
          ...Array.from(evaluationResultsColumns).map(
            (c) => `${evaluator} ${c}`
          ),
        ]
      ),
    ].map((h) => h.toLowerCase().replaceAll(" ", "_"));

    const csvData = tableData.rows.map((row) => [
      ...row.datasetColumns.map((cell) => cell.value()),
      ...row.predictedColumns.map((cell) => cell.value()),
      row.cost.value(),
      row.duration.value(),
      ...Object.entries(row.evaluationsColumns).flatMap(([_, item]) => [
        ...item.evaluationInputs.map((cell) => cell.value()),
        ...item.evaluationResults.map((cell) => cell.value()),
      ]),
    ]);

    const csvBlob = Parse.unparse({
      fields: csvHeaders,
      data: csvData,
    });

    const url = window.URL.createObjectURL(new Blob([csvBlob]));

    const link = document.createElement("a");
    link.href = url;
    const formattedDate = new Date(run.data.timestamps.created_at)
      .toISOString()
      .split("T")[0];
    const fileName = `${formattedDate}_${experiment.name}_${runId}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return { downloadCSV, isDownloadCSVEnabled };
};

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
    const [tabIndex, setTabIndex] = useState(0);

    const {
      run,
      datasetByIndex,
      datasetColumns,
      predictedColumns,
      resultsByEvaluator,
    } = useBatchEvaluationResults({
      project,
      experiment,
      runId,
      isFinished,
    });

    const [hasScrolled, setHasScrolled] = useState(false);

    const { downloadCSV, isDownloadCSVEnabled } = useBatchEvaluationDownloadCSV(
      {
        project,
        experiment,
        runId,
        isFinished,
      }
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
      return (
        <VStack gap={0} width="full" height="full" minWidth="0">
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

    if (Object.keys(resultsByEvaluator).length === 0) {
      return (
        <Text padding={4}>
          {!isFinished
            ? "Waiting for the first results to arrive..."
            : "No results"}
        </Text>
      );
    }

    return (
      <Tabs
        size={size}
        width="full"
        height="full"
        display="flex"
        flexDirection="column"
        minHeight="0"
        overflowX="hidden"
        position="relative"
        onChange={(index) => setTabIndex(index)}
        index={tabIndex}
      >
        <HStack top={1} right={2}>
          <TabList minWidth={0}>
            {Object.entries(resultsByEvaluator).map(([evaluator, results]) => (
              <Tab
                key={evaluator}
                lineClamp={1}
                whiteSpace="nowrap"
                minWidth={0}
              >
                {results.find((r) => r.name)?.name ?? evaluator}
              </Tab>
            ))}
          </TabList>
          <Spacer />
          <Text color="gray.400" fontSize="12px" flexShrink={0}>
            {runId}
          </Text>
          {size === "sm" && (
            <Menu>
              <MenuButton flexShrink={0} paddingRight={1} marginRight={1}>
                <MoreVertical size={16} />
              </MenuButton>
              <MenuList>
                <MenuItem
                  icon={<ExternalLink size={16} />}
                  onClick={() =>
                    void window.open(
                      `/${project.slug}/experiments/${experiment.slug}?runId=${runId}`,
                      "_blank"
                    )
                  }
                >
                  Open Experiment Full Page
                </MenuItem>
                <MenuItem
                  icon={<Download size={16} />}
                  onClick={() => void downloadCSV()}
                  isDisabled={!isDownloadCSVEnabled}
                >
                  Export to CSV
                </MenuItem>
              </MenuList>
            </Menu>
          )}
        </HStack>
        <TabPanels minWidth="full" minHeight="0" overflowY="auto">
          {Object.entries(resultsByEvaluator).map(
            ([evaluator, results], index) => {
              return (
                <TabPanel
                  key={evaluator}
                  padding={0}
                  minWidth="full"
                  width="fit-content"
                  minHeight="0"
                >
                  {tabIndex === index ? (
                    <BatchEvaluationV2EvaluationResult
                      evaluator={evaluator}
                      results={results}
                      datasetByIndex={datasetByIndex}
                      datasetColumns={datasetColumns}
                      predictedColumns={predictedColumns}
                      isFinished={isFinished}
                      size={size}
                      hasScrolled={hasScrolled}
                      workflowId={experiment.workflowId}
                    />
                  ) : null}
                </TabPanel>
              );
            }
          )}
        </TabPanels>
      </Tabs>
    );
  }
);
