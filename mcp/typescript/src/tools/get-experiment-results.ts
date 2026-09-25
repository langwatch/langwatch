import { LangWatchApiError, makeRequest } from "../langwatch-api.js";
import { deriveRunStatus, isTerminalStatus } from "./experiment-run-status.js";

interface DatasetEntry {
  index: number;
  targetId?: string | null;
  entry: Record<string, unknown>;
  predicted?: Record<string, unknown>;
  cost?: number | null;
  duration?: number | null;
  error?: string | null;
  traceId?: string | null;
}

interface EvaluationItem {
  evaluator: string;
  name?: string | null;
  index: number;
  targetId?: string | null;
  status: "processed" | "skipped" | "error";
  score?: number | null;
  label?: string | null;
  passed?: boolean | null;
  details?: string | null;
  inputs?: Record<string, unknown> | null;
}

interface EvaluationRunResults {
  experimentId: string;
  runId: string;
  projectId: string;
  progress?: number | null;
  total?: number | null;
  dataset: DatasetEntry[];
  evaluations: EvaluationItem[];
  timestamps: {
    createdAt: number;
    updatedAt: number;
    finishedAt?: number | null;
    stoppedAt?: number | null;
  };
}

const DEFAULT_ROW_CAP = 50;

const rowKey = (index: number, targetId?: string | null): string => `${index}:${targetId ?? ""}`;

const summarizeEntry = (entry: Record<string, unknown>): string => {
  const candidates = ["input", "question", "query", "prompt", "user"];
  for (const key of candidates) {
    const value = entry[key];
    if (typeof value === "string" && value.length > 0) {
      return value.length > 80 ? `${value.slice(0, 77)}...` : value;
    }
  }
  return "";
};

const isFailedEvaluation = (e: EvaluationItem): boolean =>
  e.status === "error" || e.passed === false;

const isFailedRow = ({
  entry,
  evaluations,
}: {
  entry: DatasetEntry;
  evaluations: EvaluationItem[];
}): boolean => Boolean(entry.error) || evaluations.some(isFailedEvaluation);

function hasNumericStatus(error: unknown): error is { status: number } {
  if (typeof error !== "object" || error === null) return false;
  return "status" in error && typeof error.status === "number";
}

type RunStatus = ReturnType<typeof deriveRunStatus>;
type ResultRow = { entry: DatasetEntry; evaluations: EvaluationItem[] };
type EvaluatorStats = {
  sum: number;
  count: number;
  passed: number;
  failed: number;
  errored: number;
};

function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  let status: number | undefined;
  if (error instanceof LangWatchApiError) status = error.status;
  else if (hasNumericStatus(error)) status = error.status;
  return status === 404 || (status === undefined && /404|not found/i.test(message));
}

async function fetchRunResults(params: {
  runId: string;
  experimentSlug?: string;
}): Promise<EvaluationRunResults | null> {
  const search = new URLSearchParams();
  if (params.experimentSlug) search.set("experimentSlug", params.experimentSlug);
  const qs = search.toString() ? `?${search.toString()}` : "";
  return (await makeRequest(
    "GET",
    `/api/v1/experiments/runs/${encodeURIComponent(params.runId)}/results${qs}`,
  )) as EvaluationRunResults;
}

/** Evaluations grouped by target-scoped row key, keeping only the filtered evaluator. */
function groupEvaluationsByRow({
  evaluations,
  evaluatorFilter,
}: {
  evaluations: EvaluationItem[];
  evaluatorFilter: string | undefined;
}): Map<string, EvaluationItem[]> {
  const byRow = new Map<string, EvaluationItem[]>();
  for (const evaluation of evaluations) {
    if (evaluatorFilter && evaluation.evaluator !== evaluatorFilter) continue;
    const key = rowKey(evaluation.index, evaluation.targetId);
    const list = byRow.get(key) ?? [];
    list.push(evaluation);
    byRow.set(key, list);
  }
  return byRow;
}

function tallyEvaluatorStats(rows: ResultRow[]): Map<string, EvaluatorStats> {
  const averages = new Map<string, EvaluatorStats>();
  for (const r of rows) {
    for (const e of r.evaluations) {
      const stats = averages.get(e.evaluator) ?? {
        sum: 0,
        count: 0,
        passed: 0,
        failed: 0,
        errored: 0,
      };
      if (typeof e.score === "number") {
        stats.sum += e.score;
        stats.count += 1;
      }
      if (e.status === "error") stats.errored += 1;
      else if (e.passed === true) stats.passed += 1;
      else if (e.passed === false) stats.failed += 1;
      averages.set(e.evaluator, stats);
    }
  }
  return averages;
}

function headerLines({
  results,
  runStatus,
  filter,
  evaluatorFilter,
}: {
  results: EvaluationRunResults;
  runStatus: RunStatus;
  filter: "all" | "failed";
  evaluatorFilter: string | undefined;
}): string[] {
  const lines: string[] = [];
  lines.push(`# Evaluation Results: ${results.runId}`);
  lines.push("");
  lines.push(`**Experiment**: ${results.experimentId}`);
  lines.push(`**Status**: ${runStatus}`);
  if (typeof results.total === "number" && results.total > 0) {
    lines.push(`**Progress**: ${results.progress ?? results.dataset.length}/${results.total} rows`);
  }
  lines.push(`**Total rows**: ${results.dataset.length}`);
  lines.push(`**Total evaluations**: ${results.evaluations.length}`);
  if (filter === "failed") lines.push(`**Filter**: failed only`);
  if (evaluatorFilter) lines.push(`**Evaluator filter**: ${evaluatorFilter}`);
  if (!isTerminalStatus(runStatus)) {
    lines.push("");
    lines.push(
      runStatus === "interrupted"
        ? "> These are partial results. The run never sent a finished/stopped marker and has had no updates recently, so it likely was interrupted before completing. The rows below are everything recorded so far."
        : "> These are partial results. The run is still in progress, so more rows may appear on a later call.",
    );
  }
  lines.push("");
  return lines;
}

function evaluatorSummaryLines(averages: Map<string, EvaluatorStats>): string[] {
  if (averages.size === 0) return [];
  const lines = [
    "## Evaluator Summary",
    "",
    "| Evaluator | Avg Score | Passed | Failed | Errored |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const [name, stats] of averages) {
    const avg = stats.count > 0 ? (stats.sum / stats.count).toFixed(3) : "—";
    lines.push(`| ${name} | ${avg} | ${stats.passed} | ${stats.failed} | ${stats.errored} |`);
  }
  lines.push("");
  return lines;
}

function noRowsLine({ filter, runStatus }: { filter: "all" | "failed"; runStatus: RunStatus }) {
  if (filter === "failed") return "_No rows matched the filter._";
  if (runStatus === "running")
    return "_No rows recorded yet. The run is still in progress; call again shortly._";
  if (runStatus === "interrupted") return "_No rows were recorded before the run was interrupted._";
  return "_No rows recorded for this run._";
}

function evaluationLines(e: EvaluationItem): string[] {
  const parts: string[] = [`**${e.evaluator}**`];
  if (e.status === "error") parts.push("status=error");
  else if (typeof e.score === "number") parts.push(`score=${e.score.toFixed(3)}`);
  if (typeof e.passed === "boolean") parts.push(`passed=${e.passed ? "yes" : "no"}`);
  if (e.label) parts.push(`label=${e.label}`);
  const lines = [`- ${parts.join(" · ")}`];
  if (e.details) lines.push(`  - details: ${e.details}`);
  return lines;
}

function rowLines({
  row: { entry, evaluations },
  anyEvaluators,
}: {
  row: ResultRow;
  anyEvaluators: boolean;
}): string[] {
  const summary = summarizeEntry(entry.entry);
  const lines = [`### Row #${entry.index}${summary ? ` — ${summary}` : ""}`];
  if (entry.error) lines.push(`- **Error**: ${entry.error}`);
  if (entry.traceId) lines.push(`- **Trace ID**: \`${entry.traceId}\``);
  if (evaluations.length === 0) {
    lines.push(
      anyEvaluators ? "- _No evaluations recorded for this row_" : "- _No evaluations recorded_",
    );
  }
  for (const e of evaluations) lines.push(...evaluationLines(e));
  lines.push("");
  return lines;
}

function notFoundReport({ runId, expired }: { runId: string; expired: boolean }): string {
  const lines = [`# Evaluation Results: ${runId}`, "", "**Status**: not found", ""];
  if (expired) {
    lines.push(
      `Could not load results for run \`${runId}\`. The run id may be incorrect, or its run state may have expired (Redis keeps it for 24h).`,
      "",
      "> Pass `experimentSlug` to load results for runs older than 24h. Discover the slug with `platform_experiment_list`, then `platform_experiment_list_runs` for the run ids.",
    );
  } else {
    lines.push(
      `Could not load results for run \`${runId}\`.`,
      "",
      "> Pass `experimentSlug` if the run is older than 24h. Discover the slug with `platform_experiment_list`, then `platform_experiment_list_runs` to confirm the run id.",
    );
  }
  return lines.join("\n");
}

export async function handleExperimentResults(params: {
  runId: string;
  experimentSlug?: string;
  filter?: "all" | "failed";
  evaluator?: string;
  limit?: number;
}): Promise<string> {
  const filter = params.filter ?? "all";
  const evaluatorFilter = params.evaluator?.trim();
  const limit =
    typeof params.limit === "number" && params.limit > 0
      ? Math.min(params.limit, DEFAULT_ROW_CAP)
      : DEFAULT_ROW_CAP;

  let results: EvaluationRunResults | null;
  try {
    results = await fetchRunResults(params);
  } catch (error) {
    if (isNotFoundError(error)) return notFoundReport({ runId: params.runId, expired: true });
    throw error;
  }
  if (!results) return notFoundReport({ runId: params.runId, expired: false });

  // Partial results are served while the run is in progress: rows land
  // incrementally, and a run whose SDK died before flushing still has useful
  // rows, so we never gate on a terminal status.
  const runStatus = deriveRunStatus(results.timestamps);
  const evaluationsByRow = groupEvaluationsByRow({
    evaluations: results.evaluations,
    evaluatorFilter,
  });
  const evaluatorNames = new Set(
    (evaluatorFilter
      ? results.evaluations.filter((e) => e.evaluator === evaluatorFilter)
      : results.evaluations
    ).map((e) => e.evaluator),
  );

  const allRows: ResultRow[] = results.dataset.map((entry) => ({
    entry,
    evaluations: evaluationsByRow.get(rowKey(entry.index, entry.targetId)) ?? [],
  }));
  // The summary covers the filtered rows before truncation.
  const matching = filter === "failed" ? allRows.filter((r) => isFailedRow(r)) : allRows;
  const truncated = matching.length > limit;
  const rows = matching.slice(0, limit);

  const lines = [
    ...headerLines({ results, runStatus, filter, evaluatorFilter }),
    ...evaluatorSummaryLines(tallyEvaluatorStats(matching)),
  ];
  if (rows.length === 0) {
    lines.push(noRowsLine({ filter, runStatus }));
    return lines.join("\n");
  }

  lines.push(`## Rows (${rows.length}${truncated ? ` of ${matching.length}` : ""})`);
  lines.push("");
  for (const row of rows) lines.push(...rowLines({ row, anyEvaluators: evaluatorNames.size > 0 }));
  if (truncated) {
    lines.push(
      `> Output truncated to ${limit} rows of ${matching.length} matching to protect the agent's context window. Pass \`limit\` to expand or filter further.`,
    );
  }
  return lines.join("\n");
}
