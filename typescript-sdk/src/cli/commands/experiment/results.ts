import chalk from "chalk";
import ora from "ora";
import {
  ExperimentsApiService,
  type ExperimentRunResultsResponse,
  type ExperimentRunDatasetEntry,
  type ExperimentRunEvaluation,
} from "@/client-sdk/services/experiments/experiments-api.service";
import {
  deriveRunStatus,
  isTerminalStatus,
} from "@/client-sdk/services/experiments/run-status";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { formatTable } from "../../utils/formatting";

export type ExperimentResultsFilter = "failed" | "all";
export type ExperimentResultsFormat = "table" | "json";

export interface ExperimentResultsOptions {
  filter?: string;
  evaluator?: string;
  format?: string;
  limit?: string;
  experiment?: string;
}

const DEFAULT_LIMIT = 20;

const rowKey = (index: number, targetId?: string | null): string =>
  `${index}:${targetId ?? ""}`;

const summarizeEntry = (entry: Record<string, unknown>): string => {
  // Pick something meaningful: input, question, query, prompt, or first string field
  const candidates = ["input", "question", "query", "prompt", "user"];
  for (const key of candidates) {
    const value = entry[key];
    if (typeof value === "string" && value.length > 0) {
      return value.length > 60 ? `${value.slice(0, 57)}...` : value;
    }
  }
  const firstString = Object.entries(entry).find(
    ([, v]) => typeof v === "string" && v.length > 0,
  );
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

export const experimentResultsCommand = async ({
  runId,
  options = {},
}: {
  runId: string;
  options?: ExperimentResultsOptions;
}): Promise<void> => {
  checkApiKey();

  const filter: ExperimentResultsFilter =
    options.filter === "failed" ? "failed" : "all";
  const format: ExperimentResultsFormat =
    options.format === "json" ? "json" : "table";
  const limit = (() => {
    const parsed = options.limit ? parseInt(options.limit, 10) : DEFAULT_LIMIT;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
  })();
  const evaluatorFilter = options.evaluator?.trim();
  const experimentSlug = options.experiment?.trim();

  const service = new ExperimentsApiService();
  const spinner = ora(`Fetching results for run "${runId}"...`).start();

  try {
    const results: ExperimentRunResultsResponse = await service.getRunResults({
      runId,
      experimentSlug,
    });
    const runStatus = deriveRunStatus(results.timestamps);
    spinner.succeed(
      `Loaded results for ${chalk.cyan(runId)} (${results.dataset.length} rows, ${results.evaluations.length} evaluations)`,
    );

    if (!isTerminalStatus(runStatus) && format !== "json") {
      console.log(
        chalk.yellow(
          runStatus === "interrupted"
            ? `Run status: interrupted — these are partial results (the run never sent a finished/stopped marker and has had no recent updates).`
            : `Run status: running — these are partial results, more rows may appear later.`,
        ),
      );
    }

    // Group evaluations by target-scoped row key.
    const evaluationsByRow = new Map<string, ExperimentRunEvaluation[]>();
    for (const evaluation of results.evaluations) {
      if (evaluatorFilter && evaluation.evaluator !== evaluatorFilter) continue;
      const key = rowKey(evaluation.index, evaluation.targetId);
      const list = evaluationsByRow.get(key) ?? [];
      list.push(evaluation);
      evaluationsByRow.set(key, list);
    }

    // Determine evaluator columns to show
    const evaluatorNames = evaluatorFilter
      ? [evaluatorFilter]
      : Array.from(
          new Set(results.evaluations.map((e) => e.evaluator)),
        ).slice(0, 3); // cap visible columns to keep table readable

    let rows = results.dataset.map((entry) => ({
      entry,
      evaluations: evaluationsByRow.get(rowKey(entry.index, entry.targetId)) ?? [],
    }));

    if (filter === "failed") {
      rows = rows.filter((r) =>
        isFailedRow({ entry: r.entry, evaluations: r.evaluations }),
      );
    }

    const totalMatching = rows.length;
    const truncated = rows.length > limit;
    rows = rows.slice(0, limit);

    if (format === "json") {
      console.log(
        JSON.stringify(
          {
            ...results,
            dataset: rows.map((row) => row.entry),
            evaluations: rows.flatMap((row) => row.evaluations),
            meta: {
              totalMatching,
              truncated,
              limit,
              filter,
              evaluator: evaluatorFilter ?? null,
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    if (rows.length === 0) {
      console.log(chalk.gray("No rows matched the filter."));
      return;
    }

    const headers = ["#", "Target", ...evaluatorNames, "Status"];
    const tableData = rows.map(({ entry, evaluations }) => {
      const evaluatorCols: Record<string, string> = {};
      for (const name of evaluatorNames) {
        const e = evaluations.find((x) => x.evaluator === name);
        if (!e) {
          evaluatorCols[name] = chalk.gray("—");
        } else if (e.status === "error") {
          evaluatorCols[name] = chalk.red("error");
        } else if (typeof e.score === "number") {
          const passedSuffix =
            e.passed === false
              ? chalk.red(" ✗")
              : e.passed === true
                ? chalk.green(" ✓")
                : "";
          evaluatorCols[name] = `${e.score.toFixed(2)}${passedSuffix}`;
        } else if (e.label) {
          evaluatorCols[name] = e.label;
        } else if (typeof e.passed === "boolean") {
          evaluatorCols[name] = e.passed
            ? chalk.green("pass")
            : chalk.red("fail");
        } else {
          evaluatorCols[name] = chalk.gray("—");
        }
      }
      const status = entry.error
        ? chalk.red(
            entry.error.length > 40
              ? `${entry.error.slice(0, 37)}...`
              : entry.error,
          )
        : evaluations.some(isFailedEvaluation)
          ? chalk.red("failed")
          : chalk.green("ok");

      return {
        "#": String(entry.index),
        Target: summarizeEntry(entry.entry),
        ...evaluatorCols,
        Status: status,
      };
    });

    formatTable({ data: tableData, headers });

    if (truncated) {
      console.log();
      console.log(
        chalk.gray(
          `Showing ${rows.length} of ${totalMatching} rows. Use --limit <n> or --format json for the full payload.`,
        ),
      );
    }
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch experiment results" });
    process.exit(1);
  }
};
