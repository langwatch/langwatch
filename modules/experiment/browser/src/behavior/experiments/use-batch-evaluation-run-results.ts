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

    const evaluationColumns = Object.fromEntries(
      Object.entries(resultsByEvaluator).map(([ev, res]) => [ev, getEvaluationColumns(res)]),
    );

    const totalRows = Math.max(...Object.values(datasetByIndex).map((d) => d.index + 1));

    const datasetHeaderList = Array.from(datasetColumns);
    const predictedHeaderList = Object.entries(predictedColumns).flatMap(([node, columns]) =>
      Array.from(columns).map((c) => `${node}.${c}`),
    );
    const evaluationHeaderTuples = Object.entries(evaluationColumns);

    const csvHeaders = [
      ...datasetHeaderList,
      ...predictedHeaderList,
      "Cost",
      "Duration",
      ...evaluationHeaderTuples.flatMap(
        ([evaluator, { evaluationInputsColumns, evaluationResultsColumns }]) => [
          ...Array.from(evaluationInputsColumns).map((c) => `${evaluator} ${c}`),
          ...Array.from(evaluationResultsColumns).map((c) => `${evaluator} ${c}`),
        ],
      ),
    ].map((h) => h.toLowerCase().replaceAll(" ", "_"));

    const csvData: string[][] = Array.from({ length: totalRows }).map((_, index) => {
      const datasetEntry = datasetByIndex[index];
      const row: string[] = [];
      // Dataset values
      for (const col of datasetHeaderList) {
        row.push(cellText(datasetEntry?.entry?.[col] ?? ""));
      }
      // Predicted values
      for (const key of predictedHeaderList) {
        const [node, col] = key.split(".") as [string, string];
        let value = readKey(datasetEntry?.predicted?.[node], col);
        if (value === undefined && node === "end") {
          value = datasetEntry?.predicted?.[col];
        }
        row.push(cellText(value ?? ""));
      }
      // Cost and Duration (dataset values only to match previous behavior)
      row.push(datasetEntry?.cost != null ? String(datasetEntry.cost) : "");
      row.push(datasetEntry?.duration != null ? String(datasetEntry.duration) : "");
      // Evaluation inputs/results per evaluator
      for (const [
        evaluator,
        { evaluationInputsColumns, evaluationResultsColumns },
      ] of evaluationHeaderTuples) {
        const evaluation = resultsByEvaluator[evaluator]?.find((r) => r.index === index);
        for (const col of Array.from(evaluationInputsColumns)) {
          const v = evaluation?.inputs?.[col];
          row.push(cellText(v));
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
          const v = readKey(evaluation, col);
          if (col === "details") {
            row.push(v != null ? cellText(v) : "");
          } else if (v === false) {
            row.push("false");
          } else if (v === true) {
            row.push("true");
          } else if (!isNaN(Number(v))) {
            row.push(numeral(Number(v)).format("0.[00]"));
          } else {
            row.push(v != null ? cellText(v) : "");
          }
        }
      }
      return row;
    });

    // Non-null per the `isDownloadCSVEnabled` guard above (the early
    // throw on line 208 ensures `run.data` is populated by the time we
    // get here). `getRun` returns `ExperimentRunWithItems | null` since
    // PR #3483 to handle the cold-start window where the row hasn't
    // been folded into ClickHouse yet — see service comment.
    const formattedDate = readableDate(run.data!.timestamps.createdAt).toISOString().split("T")[0];

    downloadCsv({
      fields: csvHeaders,
      rows: csvData,
      fileName: `${formattedDate}_${experiment.name}_${runId}.csv`,
    });
  };

  return { downloadCSV, isDownloadCSVEnabled };
};
