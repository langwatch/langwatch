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
import numeral from "numeral";
import Parse from "papaparse";
import React, { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, MoreVertical } from "react-feather";
import { Menu } from "../../../components/ui/menu";
import { toaster } from "../../../components/ui/toaster";
import type { ESBatchEvaluation } from "../../../server/experiments/types";
import { api } from "../../../utils/api";
import { BatchEvaluationV2EvaluationResult } from "./BatchEvaluationV2EvaluationResult";
import { getEvaluationColumns } from "./utils";

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

  const refetchingStartedAtRef = useRef<number>(Date.now());
  useEffect(() => {
    refetchingStartedAtRef.current = Date.now();
  }, [project.id, experiment.id, runId]);

  const run = api.experiments.getExperimentBatchEvaluationRun.useQuery(
    {
      projectId: project.id,
      experimentId: experiment.id,
      runId: runId ?? "",
    },
    {
      enabled: !!runId,
      refetchInterval: keepRefetching ? 1000 : false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
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
    {} as Record<number, ESBatchEvaluation["dataset"][number]>,
  );

  const datasetColumns = new Set(
    Object.values(datasetByIndex ?? {}).flatMap((item) =>
      Object.keys(item.entry ?? {}),
    ),
  );

  // Retrocompatibility with old evaluations
  const isItJustEndNode = !Object.values(datasetByIndex ?? {}).every((value) =>
    Object.values(value?.predicted ?? {}).every(
      (v) => typeof v === "object" && !Array.isArray(v),
    ),
  );
  let entriesPredictions = Object.values(datasetByIndex ?? {})
    .map((value) => value.predicted!)
    .filter(Boolean);
  if (isItJustEndNode) {
    entriesPredictions = entriesPredictions.map((value) => ({
      end: value,
    }));
  }

  let predictedColumns: Record<string, Set<string>> = {};
  for (const entry of entriesPredictions) {
    for (const [node, value] of Object.entries(entry)) {
      for (const key of Object.keys(value)) {
        if (!predictedColumns[node]) {
          predictedColumns[node] = new Set();
        }
        predictedColumns[node]!.add(key);
      }
    }
  }

  const hasErrors = Object.values(datasetByIndex ?? {}).some(
    (value) => value.error,
  );
  if (Object.keys(predictedColumns).length === 0 && hasErrors) {
    predictedColumns = {
      "": new Set(["error"]),
    };
  }

  // Group evaluations by evaluator (and target if present for V3)
  // Key format: "evaluator" or "target:evaluator"
  let resultsByEvaluator = run.data?.evaluations.reduce(
    (acc, evaluation) => {
      // For V3 evaluations, group by target + evaluator
      // For V2, just use evaluator
      const key = evaluation.target_id
        ? `${evaluation.target_id}:${evaluation.evaluator}`
        : evaluation.evaluator;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key]!.push(evaluation);
      return acc;
    },
    {} as Record<string, ESBatchEvaluation["evaluations"]>,
  );

  // Get target metadata for display names
  const targetsMap = new Map((run.data?.targets ?? []).map((t) => [t.id, t]));

  resultsByEvaluator = Object.fromEntries(
    Object.entries(resultsByEvaluator ?? {}).sort((a, b) =>
      a[0].localeCompare(b[0]),
    ),
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
    run:
      run.error && refetchingStartedAtRef.current > Date.now() - 5_000
        ? { ...run, data: undefined, error: undefined, isLoading: true }
        : run,
    datasetByIndex,
    datasetColumns,
    predictedColumns,
    resultsByEvaluator,
    targetsMap,
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
    targetsMap: _targetsMap,
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
      });
      console.error(error);
    }
  };

  const isDownloadCSVEnabled = !!runId && !!run.data && !!datasetByIndex;

  const downloadCSV_ = async () => {
    if (!isDownloadCSVEnabled) {
      throw new Error("Results not loaded yet");
    }

    const evaluationColumns = Object.fromEntries(
      Object.entries(resultsByEvaluator).map(([ev, res]) => [
        ev,
        getEvaluationColumns(res),
      ]),
    );

    const totalRows = Math.max(
      ...Object.values(datasetByIndex).map((d) => d.index + 1),
    );

    const datasetHeaderList = Array.from(datasetColumns);
    const predictedHeaderList = Object.entries(predictedColumns).flatMap(
      ([node, columns]) => Array.from(columns).map((c) => `${node}.${c}`),
    );
    const evaluationHeaderTuples = Object.entries(evaluationColumns);

    const csvHeaders = [
      ...datasetHeaderList,
      ...predictedHeaderList,
      "Cost",
      "Duration",
      ...evaluationHeaderTuples.flatMap(
        ([
          evaluator,
          { evaluationInputsColumns, evaluationResultsColumns },
        ]) => [
          ...Array.from(evaluationInputsColumns).map(
            (c) => `${evaluator} ${c}`,
          ),
          ...Array.from(evaluationResultsColumns).map(
            (c) => `${evaluator} ${c}`,
          ),
        ],
      ),
    ].map((h) => h.toLowerCase().replaceAll(" ", "_"));

    const stringify = (value: any) =>
      typeof value === "object" ? JSON.stringify(value) : (value ?? "");

    const csvData: string[][] = Array.from({ length: totalRows }).map(
      (_, index) => {
        const datasetEntry = datasetByIndex[index];
        const row: string[] = [];
        // Dataset values
        for (const col of datasetHeaderList) {
          row.push(String(stringify(datasetEntry?.entry?.[col] ?? "")));
        }
        // Predicted values
        for (const key of predictedHeaderList) {
          const [node, col] = key.split(".") as [string, string];
          let value = (datasetEntry?.predicted as any)?.[node]?.[col];
          if (value === undefined && node === "end") {
            value = (datasetEntry?.predicted as any)?.[col];
          }
          row.push(String(stringify(value ?? "")));
        }
        // Cost and Duration (dataset values only to match previous behavior)
        row.push(datasetEntry?.cost != null ? String(datasetEntry.cost) : "");
        row.push(
          datasetEntry?.duration != null ? String(datasetEntry.duration) : "",
        );
        // Evaluation inputs/results per evaluator
        for (const [
          evaluator,
          { evaluationInputsColumns, evaluationResultsColumns },
        ] of evaluationHeaderTuples) {
          const evaluation = resultsByEvaluator[evaluator]?.find(
            (r) => r.index === index,
          );
          for (const col of Array.from(evaluationInputsColumns)) {
            const v = evaluation?.inputs?.[col];
            row.push(
              String(typeof v === "object" ? JSON.stringify(v) : (v ?? "")),
            );
          }
          for (const col of Array.from(evaluationResultsColumns)) {
            if (col !== "details" && evaluation?.status === "error") {
              row.push("Error");
              continue;
            }
            if (col !== "details" && evaluation?.status === "skipped") {
              row.push("Skipped");
              continue;
            }
            const v = (evaluation as any)?.[col];
            if (col === "details") {
              row.push(v != null ? String(v) : "");
            } else if (v === false) {
              row.push("false");
            } else if (v === true) {
              row.push("true");
            } else if (!isNaN(Number(v))) {
              row.push(numeral(Number(v)).format("0.[00]"));
            } else {
              row.push(v != null ? String(v) : "");
            }
          }
        }
        return row;
      },
    );

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
    const {
      run,
      datasetByIndex,
      datasetColumns,
      predictedColumns,
      resultsByEvaluator,
      targetsMap,
    } = useBatchEvaluationResults({
      project,
      experiment,
      runId,
      isFinished,
    });

    // Helper to format tab label for V3 (target + evaluator)
    const getTabLabel = (
      key: string,
      results: ESBatchEvaluation["evaluations"],
    ) => {
      // Check if this is a V3 target:evaluator key
      if (key.includes(":")) {
        const [targetId, evaluator] = key.split(":");
        const target = targetId ? targetsMap.get(targetId) : undefined;
        const targetName = target?.name ?? targetId;
        const evaluatorName = results.find((r) => r.name)?.name ?? evaluator;
        return `${targetName} - ${evaluatorName}`;
      }
      // V2 style: just evaluator name
      return results.find((r) => r.name)?.name ?? key;
    };

    const { downloadCSV, isDownloadCSVEnabled } = useBatchEvaluationDownloadCSV(
      {
        project,
        experiment,
        runId,
        isFinished,
      },
    );

    const [tabIndex, setTabIndex] = useState(0);

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
            >
              {/* @ts-ignore */}
              <Table.Root size={size === "sm" ? "xs" : "sm"} variant="grid">
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
        position="relative"
        value={Object.keys(resultsByEvaluator)[tabIndex]}
        onValueChange={(change) =>
          setTabIndex(Object.keys(resultsByEvaluator).indexOf(change.value))
        }
        defaultValue={Object.keys(resultsByEvaluator)[0]}
        colorPalette="blue"
      >
        <HStack
          top={1}
          right={2}
          borderBottom="1px solid"
          borderColor="border"
        >
          <Tabs.List minWidth={0}>
            {Object.entries(resultsByEvaluator).map(([key, results]) => (
              <Tabs.Trigger
                key={key}
                value={key}
                css={{
                  "& span": {
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    minWidth: 0,
                  },
                }}
              >
                {getTabLabel(key, results)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Spacer />
          <Text color="fg.subtle" fontSize="12px" flexShrink={0}>
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
                      "_blank",
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
            return tabIndex === index ? (
              <Tabs.Content
                key={evaluator}
                value={evaluator}
                padding={0}
                minWidth="full"
                minHeight="0"
                overflow="auto"
              >
                <BatchEvaluationV2EvaluationResult
                  evaluator={evaluator}
                  results={results}
                  datasetByIndex={datasetByIndex}
                  datasetColumns={datasetColumns}
                  predictedColumns={predictedColumns}
                  isFinished={isFinished}
                  size={size}
                  workflowId={experiment.workflowId}
                />
              </Tabs.Content>
            ) : null;
          },
        )}
      </Tabs.Root>
    );
  },
);
