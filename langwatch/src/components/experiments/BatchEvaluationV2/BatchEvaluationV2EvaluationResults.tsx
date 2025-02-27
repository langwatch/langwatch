import {
  Alert,
  HStack,
  Skeleton,
  Spacer,
  Table,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Experiment, Project } from "@prisma/client";
import Parse from "papaparse";
import React, { useEffect, useState } from "react";
import { Download, ExternalLink, MoreVertical } from "react-feather";
import { Menu } from "../../../components/ui/menu";
import { toaster } from "../../../components/ui/toaster";
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
      toaster.create({
        title: "Error Downloading CSV",
        description: (error as any).toString(),
        type: "error",
        meta: {
          closable: true,
        },
        placement: "top-end",
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
        <Alert.Root status="error">
          <Alert.Indicator />
          Error loading evaluation results
        </Alert.Root>
      );
    }

    if (!resultsByEvaluator || !datasetByIndex) {
      return (
        <VStack gap={0} width="full" height="full" minWidth="0">
          <Tabs.Root
            size={size}
            width="full"
            height="full"
            display="flex"
            flexDirection="column"
            minHeight="0"
            overflowX="auto"
            padding={0}
            colorPalette="blue"
          >
            <Tabs.List>
              <Tabs.Trigger value="skeleton">
                <Skeleton width="60px" height="22px" />
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content
              value="skeleton"
              minWidth="full"
              minHeight="0"
              overflowY="auto"
              onScroll={() => setHasScrolled(true)}
            >
              {/* @ts-ignore */}
              <Table.Root size={size === "sm" ? "xs" : "sm"} variant="line">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader rowSpan={2} width="50px">
                      <Skeleton width="100%" height="52px" />
                    </Table.ColumnHeader>
                    <Table.ColumnHeader>
                      <Skeleton width="100%" height="18px" />
                    </Table.ColumnHeader>
                    <Table.ColumnHeader>
                      <Skeleton width="100%" height="18px" />
                    </Table.ColumnHeader>
                    <Table.ColumnHeader>
                      <Skeleton width="100%" height="18px" />
                    </Table.ColumnHeader>
                  </Table.Row>
                  <Table.Row>
                    <Table.ColumnHeader>
                      <Skeleton width="100%" height="18px" />
                    </Table.ColumnHeader>
                    <Table.ColumnHeader>
                      <Skeleton width="100%" height="18px" />
                    </Table.ColumnHeader>
                    <Table.ColumnHeader>
                      <Skeleton width="100%" height="18px" />
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  <Table.Row>
                    <Table.Cell>
                      <Skeleton width="100%" height="18px" />
                    </Table.Cell>
                    <Table.Cell>
                      <Skeleton width="100%" height="18px" />
                    </Table.Cell>
                    <Table.Cell>
                      <Skeleton width="100%" height="18px" />
                    </Table.Cell>
                    <Table.Cell>
                      <Skeleton width="100%" height="18px" />
                    </Table.Cell>
                  </Table.Row>
                </Table.Body>
              </Table.Root>
            </Tabs.Content>
          </Tabs.Root>
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
      <Tabs.Root
        size={size}
        width="full"
        height="full"
        display="flex"
        flexDirection="column"
        minHeight="0"
        overflowX="hidden"
        position="relative"
        onValueChange={(change) =>
          setTabIndex(Object.keys(resultsByEvaluator).indexOf(change.value))
        }
        defaultValue={Object.keys(resultsByEvaluator)[0]}
      >
        <HStack top={1} right={2}>
          <Tabs.List minWidth={0}>
            {Object.entries(resultsByEvaluator).map(
              ([evaluator, results], idx) => (
                <Tabs.Trigger
                  key={evaluator}
                  value={evaluator}
                  css={{
                    "& span": {
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      minWidth: 0,
                    },
                  }}
                >
                  {results.find((r) => r.name)?.name ?? evaluator}
                </Tabs.Trigger>
              )
            )}
            <Tabs.Indicator />
          </Tabs.List>
          <Spacer />
          <Text color="gray.400" fontSize="12px" flexShrink={0}>
            {runId}
          </Text>
          {size === "sm" && (
            <Menu.Root positioning={{ placement: "bottom-end" }}>
              <Menu.Trigger flexShrink={0} paddingRight={1} marginRight={1}>
                <MoreVertical size={16} />
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item
                  value="open-experiment"
                  onClick={() =>
                    void window.open(
                      `/${project.slug}/experiments/${experiment.slug}?runId=${runId}`,
                      "_blank"
                    )
                  }
                >
                  <ExternalLink size={16} /> Open Experiment Full Page
                </Menu.Item>
                <Menu.Item
                  value="export-csv"
                  onClick={() => void downloadCSV()}
                  disabled={!isDownloadCSVEnabled}
                >
                  <Download size={16} /> Export to CSV
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          )}
        </HStack>

        {Object.entries(resultsByEvaluator).map(
          ([evaluator, results], index) => {
            return (
              <Tabs.Content
                key={evaluator}
                value={evaluator}
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
              </Tabs.Content>
            );
          }
        )}
      </Tabs.Root>
    );
  }
);
