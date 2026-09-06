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

const rowKey = (index: number, targetId?: string | null): string =>
  `${index}:${targetId ?? ""}`;

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

  const search = new URLSearchParams();
  if (params.experimentSlug) search.set("experimentSlug", params.experimentSlug);
  const qs = search.toString() ? `?${search.toString()}` : "";

  let results: EvaluationRunResults | null;
  try {
    results = (await makeRequest(
      "GET",
      `/api/experiments/runs/${encodeURIComponent(params.runId)}/results${qs}`,
    )) as EvaluationRunResults;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      error instanceof LangWatchApiError
        ? error.status
        : error && typeof error === "object" &&
            "status" in error &&
            typeof (error as { status?: unknown }).status === "number"
          ? (error as { status: number }).status
          : undefined;
    if (
      status === 404 ||
      (status === undefined && /404|not found/i.test(message))
    ) {
      return [
        `# Evaluation Results: ${params.runId}`,
        "",
        "**Status**: not found",
        "",
        `Could not load results for run \`${params.runId}\`. The run id may be incorrect, or its run state may have expired (Redis keeps it for 24h).`,
        "",
        "> Pass `experimentSlug` to load results for runs older than 24h. Discover the slug with `platform_experiment_list`, then `platform_experiment_list_runs` for the run ids.",
      ].join("\n");
    }
    throw error;
  }

  if (!results) {
    return [
      `# Evaluation Results: ${params.runId}`,
      "",
      "**Status**: not found",
      "",
      `Could not load results for run \`${params.runId}\`.`,
      "",
      "> Pass `experimentSlug` if the run is older than 24h. Discover the slug with `platform_experiment_list`, then `platform_experiment_list_runs` to confirm the run id.",
    ].join("\n");
  }

  // Partial results are served even while the run is still in progress.
  // Rows land in ClickHouse incrementally, so a "running" or "interrupted"
  // run can still expose every row recorded so far. A run only fails to set
  // finished_at/stopped_at when the SDK process dies before flushing, but the
  // rows it did log are still useful, so we never gate on a terminal status.
  const runStatus = deriveRunStatus(results.timestamps);
  const partial = !isTerminalStatus(runStatus);

  // Group evaluations by target-scoped row key, applying evaluator filter.
  const evaluationsByRow = new Map<string, EvaluationItem[]>();
  for (const evaluation of results.evaluations) {
    if (evaluatorFilter && evaluation.evaluator !== evaluatorFilter) continue;
    const key = rowKey(evaluation.index, evaluation.targetId);
    const list = evaluationsByRow.get(key) ?? [];
    list.push(evaluation);
    evaluationsByRow.set(key, list);
  }

  const evaluatorNames = Array.from(
    new Set(
      (evaluatorFilter
        ? results.evaluations.filter((e) => e.evaluator === evaluatorFilter)
        : results.evaluations
      ).map((e) => e.evaluator),
    ),
  );

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
  const rowsForSummary = rows;
  const truncated = rows.length > limit;
  rows = rows.slice(0, limit);

  // Per-evaluator stats across the filtered rows (before truncation),
  // so the summary matches the displayed subset when filter="failed".
  const evaluatorAverages = new Map<
    string,
    { sum: number; count: number; passed: number; failed: number; errored: number }
  >();
  for (const r of rowsForSummary) {
    for (const e of r.evaluations) {
      const stats =
        evaluatorAverages.get(e.evaluator) ?? {
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
      evaluatorAverages.set(e.evaluator, stats);
    }
  }

  const lines: string[] = [];
  lines.push(`# Evaluation Results: ${results.runId}`);
  lines.push("");
  lines.push(`**Experiment**: ${results.experimentId}`);
  lines.push(`**Status**: ${runStatus}`);
  if (typeof results.total === "number" && results.total > 0) {
    lines.push(
      `**Progress**: ${results.progress ?? results.dataset.length}/${results.total} rows`,
    );
  }
  lines.push(`**Total rows**: ${results.dataset.length}`);
  lines.push(`**Total evaluations**: ${results.evaluations.length}`);
  if (filter === "failed") {
    lines.push(`**Filter**: failed only`);
  }
  if (evaluatorFilter) {
    lines.push(`**Evaluator filter**: ${evaluatorFilter}`);
  }
  if (partial) {
    lines.push("");
    lines.push(
      runStatus === "interrupted"
        ? "> These are partial results. The run never sent a finished/stopped marker and has had no updates recently, so it likely was interrupted before completing. The rows below are everything recorded so far."
        : "> These are partial results. The run is still in progress, so more rows may appear on a later call.",
    );
  }
  lines.push("");

  if (evaluatorAverages.size > 0) {
    lines.push("## Evaluator Summary");
    lines.push("");
    lines.push("| Evaluator | Avg Score | Passed | Failed | Errored |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const [name, stats] of evaluatorAverages) {
      const avg =
        stats.count > 0 ? (stats.sum / stats.count).toFixed(3) : "—";
      lines.push(
        `| ${name} | ${avg} | ${stats.passed} | ${stats.failed} | ${stats.errored} |`,
      );
    }
    lines.push("");
  }

  if (rows.length === 0) {
    if (filter === "failed") {
      lines.push("_No rows matched the filter._");
    } else if (runStatus === "running") {
      lines.push(
        "_No rows recorded yet. The run is still in progress; call again shortly._",
      );
    } else if (runStatus === "interrupted") {
      lines.push("_No rows were recorded before the run was interrupted._");
    } else {
      lines.push("_No rows recorded for this run._");
    }
    return lines.join("\n");
  }

  lines.push(
    `## Rows (${rows.length}${truncated ? ` of ${totalMatching}` : ""})`,
  );
  lines.push("");

  for (const { entry, evaluations } of rows) {
    const summary = summarizeEntry(entry.entry);
    lines.push(`### Row #${entry.index}${summary ? ` — ${summary}` : ""}`);
    if (entry.error) {
      lines.push(`- **Error**: ${entry.error}`);
    }
    if (entry.traceId) {
      lines.push(`- **Trace ID**: \`${entry.traceId}\``);
    }
    if (evaluations.length === 0) {
      lines.push(
        evaluatorNames.length === 0
          ? "- _No evaluations recorded_"
          : "- _No evaluations recorded for this row_",
      );
    }
    for (const e of evaluations) {
      const parts: string[] = [`**${e.evaluator}**`];
      if (e.status === "error") parts.push("status=error");
      else if (typeof e.score === "number") parts.push(`score=${e.score.toFixed(3)}`);
      if (typeof e.passed === "boolean") {
        parts.push(`passed=${e.passed ? "yes" : "no"}`);
      }
      if (e.label) parts.push(`label=${e.label}`);
      lines.push(`- ${parts.join(" · ")}`);
      if (e.details) {
        lines.push(`  - details: ${e.details}`);
      }
    }
    lines.push("");
  }

  if (truncated) {
    lines.push(
      `> Output truncated to ${limit} rows of ${totalMatching} matching to protect the agent's context window. Pass \`limit\` to expand or filter further.`,
    );
  }

  return lines.join("\n");
}
