import chalk from "chalk";

import {
  ExperimentsApiService,
  type ExperimentRunResultsResponse,
  type ExperimentRunDatasetEntry,
  type ExperimentRunEvaluation,
} from "@/client-sdk/services/experiments/experiments-api.service";
import { deriveRunStatus, isTerminalStatus } from "@/client-sdk/services/experiments/run-status";

import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { resolveRunId } from "./resolve-run";

export type ExperimentResultsFilter = "failed" | "all";

export interface ExperimentResultsOptions {
  filter?: string;
  evaluator?: string;
  limit?: string;
  runId?: string;
}

const DEFAULT_LIMIT = 20;

const rowKey = (index: number, targetId?: string | null): string => `${index}:${targetId ?? ""}`;

const summarizeEntry = (entry: Record<string, unknown>): string => {
  // Pick something meaningful: input, question, query, prompt, or first string field
  const candidates = ["input", "question", "query", "prompt", "user"];
  for (const key of candidates) {
    const value = entry[key];
    if (typeof value === "string" && value.length > 0) {
      return value.length > 60 ? `${value.slice(0, 57)}...` : value;
    }
  }
  const firstString = Object.entries(entry).find(([, v]) => typeof v === "string" && v.length > 0);
  if (firstString) {
    const v = firstString[1] as string;
    return v.length > 60 ? `${v.slice(0, 57)}...` : v;
  }
  return chalk.gray("—");
};

const isFailedEvaluation = (evaluation: ExperimentRunEvaluation): boolean => {
  if (evaluation.status === "error") return true;
  if (evaluation.passed === false) return true;
  return false;
};

const isFailedRow = ({
  entry,
  evaluations,
}: {
  entry: ExperimentRunDatasetEntry;
  evaluations: ExperimentRunEvaluation[];
}): boolean => {
  if (entry.error) return true;
  return evaluations.some((e) => isFailedEvaluation(e));
};

type RunStatus = ReturnType<typeof deriveRunStatus>;
type ResultRow = {
  entry: ExperimentRunResultsResponse["dataset"][number];
  evaluations: ExperimentRunEvaluation[];
};

/** Evaluations grouped by target-scoped row key. */
const groupByRow = ({
  evaluations,
  evaluatorFilter,
}: {
  evaluations: ExperimentRunEvaluation[];
  evaluatorFilter: string | undefined;
}): Map<string, ExperimentRunEvaluation[]> => {
  const evaluationsByRow = new Map<string, ExperimentRunEvaluation[]>();
  for (const evaluation of evaluations) {
    if (evaluatorFilter && evaluation.evaluator !== evaluatorFilter) continue;
    const key = rowKey(evaluation.index, evaluation.targetId);
    const list = evaluationsByRow.get(key) ?? [];
    list.push(evaluation);
    evaluationsByRow.set(key, list);
  }
  return evaluationsByRow;
};

const passedSuffix = (passed: boolean | null | undefined): string => {
  if (passed === false) return chalk.red(" ✗");
  if (passed === true) return chalk.green(" ✓");
  return "";
};

const evaluatorCell = (e: ExperimentRunEvaluation | undefined): string => {
  if (!e) return chalk.gray("—");
  if (e.status === "error") return chalk.red("error");
  if (typeof e.score === "number") return `${e.score.toFixed(2)}${passedSuffix(e.passed)}`;
  if (e.label) return e.label;
  if (typeof e.passed === "boolean") return e.passed ? chalk.green("pass") : chalk.red("fail");
  return chalk.gray("—");
};

const rowStatus = ({ entry, evaluations }: ResultRow): string => {
  if (entry.error) {
    const error = entry.error.length > 40 ? `${entry.error.slice(0, 37)}...` : entry.error;
    return chalk.red(error);
  }
  return evaluations.some(isFailedEvaluation) ? chalk.red("failed") : chalk.green("ok");
};

const emptyResultsNotice = ({
  filter,
  runStatus,
}: {
  filter: ExperimentResultsFilter;
  runStatus: RunStatus;
}): string => {
  if (filter === "failed") return "No rows matched the filter.";
  if (runStatus === "running") {
    return "No rows recorded yet. The run is still in progress; run this again shortly.";
  }
  if (runStatus === "interrupted") return "No rows were recorded before the run was interrupted.";
  return "No rows recorded for this run.";
};

const printResultsTable = ({
  runStatus,
  shownRows,
  filter,
  evaluatorNames,
  tableTruncated,
  totalMatching,
}: {
  runStatus: RunStatus;
  shownRows: ResultRow[];
  filter: ExperimentResultsFilter;
  evaluatorNames: string[];
  tableTruncated: boolean;
  totalMatching: number;
}): void => {
  if (!isTerminalStatus(runStatus)) {
    console.log(
      chalk.yellow(
        runStatus === "interrupted"
          ? `Run status: interrupted. These are partial results (the run never sent a finished/stopped marker and has had no recent updates).`
          : `Run status: running. These are partial results; more rows may appear later.`,
      ),
    );
  }

  if (shownRows.length === 0) {
    console.log(chalk.gray(emptyResultsNotice({ filter, runStatus })));
    return;
  }

  const headers = ["#", "Target", ...evaluatorNames, "Status"];
  const tableData = shownRows.map((row) => ({
    "#": String(row.entry.index),
    Target: summarizeEntry(row.entry.entry),
    ...Object.fromEntries(
      evaluatorNames.map((name) => [
        name,
        evaluatorCell(row.evaluations.find((x) => x.evaluator === name)),
      ]),
    ),
    Status: rowStatus(row),
  }));

  formatTable({ data: tableData, headers });

  if (tableTruncated) {
    console.log();
    console.log(
      chalk.gray(
        `Showing ${shownRows.length} of ${totalMatching} rows. Use --limit <n> to print more. The JSON answer already carries every row.`,
      ),
    );
  }
};

export const experimentResultsCommand = async ({
  experimentSlug,
  options = {},
}: {
  experimentSlug: string;
  options?: ExperimentResultsOptions;
}): Promise<CommandResult | void> => {
  await resolveCredentials();

  const filter: ExperimentResultsFilter = options.filter === "failed" ? "failed" : "all";
  const limit = (() => {
    const parsed = options.limit ? parseInt(options.limit, 10) : DEFAULT_LIMIT;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
  })();
  const evaluatorFilter = options.evaluator?.trim();

  const service = new ExperimentsApiService();
  const spinner = createSpinner(`Fetching results for "${experimentSlug}"...`).start();

  try {
    const runId = await resolveRunId({
      service,
      experimentSlug,
      runId: options.runId,
    });
    const results: ExperimentRunResultsResponse = await service.getRunResults({
      runId,
      experimentSlug,
    });
    const runStatus = deriveRunStatus(results.timestamps);
    spinner.succeed(
      `Loaded results for ${chalk.cyan(runId)} (${results.dataset.length} rows, ${results.evaluations.length} evaluations)`,
    );

    const evaluationsByRow = groupByRow({ evaluations: results.evaluations, evaluatorFilter });

    // Comparison evaluator verdicts: keyed to row, not (row, target).
    // They follow rows that survive filter and limit.
    const datasetKeys = new Set(
      results.dataset.map((entry) => rowKey(entry.index, entry.targetId)),
    );
    const rowIndependentEvaluations = results.evaluations.filter((evaluation) => {
      if (evaluatorFilter && evaluation.evaluator !== evaluatorFilter) {
        return false;
      }
      return !datasetKeys.has(rowKey(evaluation.index, evaluation.targetId));
    });

    // Determine evaluator columns to show, capped at 3 to keep table readable
    const evaluatorNames = evaluatorFilter
      ? [evaluatorFilter]
      : Array.from(new Set(results.evaluations.map((e) => e.evaluator))).slice(0, 3);

    let rows = results.dataset.map((entry) => ({
      entry,
      evaluations: evaluationsByRow.get(rowKey(entry.index, entry.targetId)) ?? [],
    }));

    // Comparison failures aren't visible through dataset join.
    // Grouped by row index. The comparison covers the whole field on that row.
    const rowIndependentByIndex = new Map<number, ExperimentRunEvaluation[]>();
    for (const evaluation of rowIndependentEvaluations) {
      const list = rowIndependentByIndex.get(evaluation.index) ?? [];
      list.push(evaluation);
      rowIndependentByIndex.set(evaluation.index, list);
    }

    if (filter === "failed") {
      rows = rows.filter((r) =>
        isFailedRow({
          entry: r.entry,
          evaluations: [...r.evaluations, ...(rowIndependentByIndex.get(r.entry.index) ?? [])],
        }),
      );
    }

    const totalMatching = rows.length;

    // `--limit` shortens table only, never the answer.
    // Agents computing rates from the payload need every row.
    const shownRows = rows.slice(0, limit);
    const tableTruncated = rows.length > limit;

    // Carry a row-independent evaluation only when its row is in the answer,
    // so a verdict never describes a row the caller cannot see.
    const returnedIndices = new Set(rows.map((row) => row.entry.index));
    const returnedRowIndependent = rowIndependentEvaluations.filter((evaluation) =>
      returnedIndices.has(evaluation.index),
    );

    return {
      data: {
        ...results,
        dataset: rows.map((row) => row.entry),
        evaluations: [...rows.flatMap((row) => row.evaluations), ...returnedRowIndependent],
        meta: {
          totalMatching,
          /** Rows in `dataset`. Equal to `totalMatching`: the answer is whole. */
          returned: rows.length,
          /** `--limit` applies to the printed table only. */
          tableLimit: limit,
          tableTruncated,
          /**
           * "explicit" if --run-id was passed, "latest-at-call-time" otherwise.
           * Two calls either side of a new run give different numbers.
           */
          runSelection: options.runId?.trim() ? "explicit" : "latest-at-call-time",
          filter,
          evaluator: evaluatorFilter ?? null,
        },
      },
      table: () =>
        printResultsTable({
          runStatus,
          shownRows,
          filter,
          evaluatorNames,
          tableTruncated,
          totalMatching,
        }),
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch experiment results" });
    process.exit(1);
  }
};
