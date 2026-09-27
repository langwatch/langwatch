import { showErrorToast } from "@langwatch/browser-host/errors";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { downloadCsv } from "@langwatch/csv/download";
import { readableDate } from "@langwatch/experiment-browser-kit";
import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";
import { nowInstant } from "@langwatch/time";
import type { Experiment, Project } from "@langwatch/workflow-contract";
import numeral from "numeral";
import { useEffect, useRef, useState } from "react";

import {
  cellText,
  getEvaluationColumns,
  readKey,
} from "../../model/experiments/BatchEvaluationV2/utils.ts";

const collectPredictedColumns = (
  entriesPredictions: Record<string, unknown>[],
): Record<string, Set<string>> => {
  const predictedColumns: Record<string, Set<string>> = {};
  for (const entry of entriesPredictions) {
    for (const [node, value] of Object.entries(entry)) {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        if (!predictedColumns[node]) {
          predictedColumns[node] = new Set();
        }
        predictedColumns[node]!.add(key);
      }
    }
  }
  return predictedColumns;
};

/**
 * A batch evaluation run and its results, shaped for the results table.
 * Moved out of `BatchEvaluationV2EvaluationResults` (Record 10: elements
 * cannot fetch).
 */
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

  const refetchingStartedAtRef = useRef<number>(nowInstant().epochMilliseconds);
  useEffect(() => {
    refetchingStartedAtRef.current = nowInstant().epochMilliseconds;
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
      const stopRefetchingTimeout = setTimeout(() => {
        setKeepRefetching(false);
      }, 2_000);
      return () => clearTimeout(stopRefetchingTimeout);
    }
    setKeepRefetching(true);
    // `apps/ui` compiles this package under `noImplicitReturns`: an effect with
    // a cleanup on one branch has to say so on the other.
    return undefined;
  }, [isFinished]);

  const runData: ExperimentRunWithItems | null | undefined = run.data;
  const datasetByIndex = runData?.dataset.reduce<
    Record<number, ExperimentRunWithItems["dataset"][number]>
  >((acc, item) => {
    acc[item.index] = item;
    return acc;
  }, {});

  const datasetColumns = new Set(
    Object.values(datasetByIndex ?? {}).flatMap((item) => Object.keys(item.entry ?? {})),
  );

  // Retrocompatibility with old evaluations
  const isItJustEndNode = !Object.values(datasetByIndex ?? {}).every((value) =>
    Object.values(value?.predicted ?? {}).every((v) => typeof v === "object" && !Array.isArray(v)),
  );
  let entriesPredictions: Record<string, unknown>[] = Object.values(datasetByIndex ?? {}).flatMap<
    Record<string, unknown>
  >((value) => value.predicted ?? []);
  if (isItJustEndNode) {
    entriesPredictions = entriesPredictions.map((value) => ({
      end: value,
    }));
  }

  let predictedColumns = collectPredictedColumns(entriesPredictions);

  const hasErrors = Object.values(datasetByIndex ?? {}).some((value) => value.error);
  if (Object.keys(predictedColumns).length === 0 && hasErrors) {
    predictedColumns = {
      "": new Set(["error"]),
    };
  }

  // Group evaluations by evaluator (and target if present for V3)
  // Key format: "evaluator" or "target:evaluator"
  let resultsByEvaluator = runData?.evaluations.reduce<
    Record<string, ExperimentRunWithItems["evaluations"]>
  >((acc, evaluation) => {
    // For V3 evaluations, group by target + evaluator
    // For V2, just use evaluator
    const key = evaluation.targetId
      ? `${evaluation.targetId}:${evaluation.evaluator}`
      : evaluation.evaluator;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key]!.push(evaluation);
    return acc;
  }, {});

  // Get target metadata for display names
  const targetsMap = new Map((runData?.targets ?? []).map((t) => [t.id, t] as const));

  resultsByEvaluator = Object.fromEntries(
    Object.entries(resultsByEvaluator ?? {}).toSorted((a, b) => a[0].localeCompare(b[0])),
  );

  if (Object.keys(resultsByEvaluator ?? {}).length === 0 && (runData?.dataset.length ?? 0) > 0) {
    resultsByEvaluator = {
      Predictions: [],
    };
  }

  return {
    run:
      run.error && refetchingStartedAtRef.current > nowInstant().epochMilliseconds - 5_000
        ? { ...run, data: undefined, error: undefined, isLoading: true }
        : run,
    datasetByIndex,
    datasetColumns,
    predictedColumns,
    resultsByEvaluator,
    targetsMap,
  };
};

type RunDatasetEntry = ExperimentRunWithItems["dataset"][number];
type RunEvaluations = ExperimentRunWithItems["evaluations"];
type EvaluationColumns = {
  evaluationInputsColumns: Set<string>;
  evaluationResultsColumns: Set<string>;
};

/** A predicted `node.col` value; old runs stored the end node's fields flat. */
const predictedCell = (entry: RunDatasetEntry | undefined, key: string): string => {
  const [node, col] = key.split(".") as [string, string];
  const value = readKey(entry?.predicted?.[node], col);
  const flat = value === undefined && node === "end" ? entry?.predicted?.[col] : value;
  return cellText(flat ?? "");
};

const optionalText = (value: unknown): string => (value != null ? cellText(value) : "");

/** An evaluation result cell: a failed or skipped evaluation says so, except in its details. */
const evaluationResultCell = (evaluation: RunEvaluations[number] | undefined, col: string) => {
  const value = readKey(evaluation, col);
  if (col === "details") return optionalText(value);
  if (evaluation?.status === "error") return "Error";
  if (evaluation?.status === "skipped") return "Skipped";
  if (typeof value === "boolean") return String(value);
  if (!isNaN(Number(value))) return numeral(Number(value)).format("0.[00]");
  return optionalText(value);
};

const evaluationCells = ({
  evaluation,
  columns,
}: {
  evaluation: RunEvaluations[number] | undefined;
  columns: EvaluationColumns;
}): string[] => [
  ...[...columns.evaluationInputsColumns].map((col) => cellText(evaluation?.inputs?.[col])),
  ...[...columns.evaluationResultsColumns].map((col) => evaluationResultCell(evaluation, col)),
];

/** The run's results as CSV headers and rows; cost and duration are the dataset entry's own. */
const resultsCsvOf = ({
  datasetByIndex,
  datasetColumns,
  predictedColumns,
  resultsByEvaluator,
}: {
  datasetByIndex: Record<number, RunDatasetEntry>;
  datasetColumns: Set<string>;
  predictedColumns: Record<string, Set<string>>;
  resultsByEvaluator: Record<string, RunEvaluations>;
}) => {
  const evaluationColumns = Object.entries(resultsByEvaluator).map(
    ([evaluator, results]) => [evaluator, getEvaluationColumns(results)] as const,
  );
  const datasetHeaders = [...datasetColumns];
  const predictedHeaders = Object.entries(predictedColumns).flatMap(([node, columns]) =>
    [...columns].map((c) => `${node}.${c}`),
  );
  const fields = [
    ...datasetHeaders,
    ...predictedHeaders,
    "Cost",
    "Duration",
    ...evaluationColumns.flatMap(([evaluator, columns]) =>
      [...columns.evaluationInputsColumns, ...columns.evaluationResultsColumns].map(
        (c) => `${evaluator} ${c}`,
      ),
    ),
  ].map((h) => h.toLowerCase().replaceAll(" ", "_"));

  const totalRows = Math.max(...Object.values(datasetByIndex).map((d) => d.index + 1));
  const rows = Array.from({ length: totalRows }, (_, index) => {
    const entry = datasetByIndex[index];
    return [
      ...datasetHeaders.map((col) => cellText(entry?.entry?.[col] ?? "")),
      ...predictedHeaders.map((key) => predictedCell(entry, key)),
      entry?.cost != null ? String(entry.cost) : "",
      entry?.duration != null ? String(entry.duration) : "",
      ...evaluationColumns.flatMap(([evaluator, columns]) =>
        evaluationCells({
          evaluation: resultsByEvaluator[evaluator]?.find((r) => r.index === index),
          columns,
        }),
      ),
    ];
  });
  return { fields, rows };
};

/**
 * CSV export of a batch evaluation run's results. Moved out of
 * `BatchEvaluationV2EvaluationResults` (Record 10: elements cannot fetch).
 */
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
      showErrorToast({
        error,
        fallbackTitle: "Couldn't download the CSV",
      });
      console.error(error);
    }
  };

  const isDownloadCSVEnabled = !!runId && !!run.data && !!datasetByIndex;

  const downloadCSV_ = async () => {
    if (!isDownloadCSVEnabled) {
      throw new Error("Results not loaded yet");
    }
    const { fields, rows } = resultsCsvOf({
      datasetByIndex,
      datasetColumns,
      predictedColumns,
      resultsByEvaluator,
    });
    const formattedDate = readableDate(run.data.timestamps.createdAt).toISOString().split("T")[0];
    downloadCsv({ fields, rows, fileName: `${formattedDate}_${experiment.name}_${runId}.csv` });
  };

  return { downloadCSV, isDownloadCSVEnabled };
};
