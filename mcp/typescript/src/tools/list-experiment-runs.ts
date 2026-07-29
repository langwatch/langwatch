import { makeRequest } from "../langwatch-api.js";

interface RunSummaryEvaluator {
  name: string;
  averageScore: number | null;
  averagePassed?: number;
}

interface RunSummary {
  evaluations: Record<string, RunSummaryEvaluator>;
}

interface ExperimentRunSummaryEntry {
  experimentId: string;
  runId: string;
  workflowVersion: { id: string; version: string } | null;
  timestamps: {
    createdAt: number;
    updatedAt: number;
    finishedAt?: number | null;
    stoppedAt?: number | null;
  };
  progress?: number | null;
  total?: number | null;
  summary: RunSummary;
}

interface ExperimentRunsListResponse {
  experimentId: string;
  experimentSlug: string;
  runs: ExperimentRunSummaryEntry[];
  pagination: {
    page: number;
    pageSize: number;
    totalHits: number;
    hasMore: boolean;
  };
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const formatEpoch = (epoch: number | null | undefined): string => {
  if (!epoch || !Number.isFinite(epoch)) return "—";
  return new Date(epoch).toISOString().replace("T", " ").slice(0, 19) + " UTC";
};

const passRate = (evaluations: RunSummary["evaluations"]): string => {
  const entries = Object.values(evaluations ?? {});
  if (entries.length === 0) return "—";
  const passed = entries.filter((e) => typeof e.averagePassed === "number");
  if (passed.length === 0) {
    const scored = entries.filter((e) => typeof e.averageScore === "number");
    if (scored.length === 0) return "—";
    const avg =
      scored.reduce((sum, e) => sum + (e.averageScore ?? 0), 0) / scored.length;
    return `${avg.toFixed(2)} avg`;
  }
  const avg =
    passed.reduce((sum, e) => sum + (e.averagePassed ?? 0), 0) / passed.length;
  return `${(avg * 100).toFixed(0)}% pass`;
};

const runStatus = (run: ExperimentRunSummaryEntry): string => {
  if (run.timestamps.stoppedAt) return "stopped";
  if (run.timestamps.finishedAt) return "completed";
  return "running";
};

export async function handleExperimentListRuns(params: {
  experimentSlug: string;
  limit?: number;
}): Promise<string> {
  const requested =
    typeof params.limit === "number" && params.limit > 0
      ? params.limit
      : DEFAULT_LIMIT;
  const effectiveLimit = Math.min(requested, MAX_LIMIT);

  const search = new URLSearchParams();
  search.set("experimentSlug", params.experimentSlug);
  search.set("pageSize", String(effectiveLimit));

  let result: ExperimentRunsListResponse;
  try {
    result = (await makeRequest(
      "GET",
      `/api/experiments/runs?${search.toString()}`,
    )) as ExperimentRunsListResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/404|not found/i.test(message)) {
      return [
        `# Evaluation Runs: ${params.experimentSlug}`,
        "",
        "**Status**: experiment not found",
        "",
        `No experiment with slug \`${params.experimentSlug}\` exists in this project.`,
        "",
        "> Run `platform_experiment_list` to discover available experiment slugs.",
      ].join("\n");
    }
    throw error;
  }

  if (result.runs.length === 0) {
    return [
      `# Evaluation Runs: ${result.experimentSlug}`,
      "",
      "_This experiment has no runs yet._",
      "",
      `> Trigger a run with \`platform_run_experiment\` (slug: \`${result.experimentSlug}\`) to populate this list.`,
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(`# Evaluation Runs: ${result.experimentSlug}`);
  lines.push("");
  lines.push(
    `Showing ${result.runs.length} of ${result.pagination.totalHits} run${result.pagination.totalHits === 1 ? "" : "s"}.`,
  );
  if (result.pagination.hasMore) {
    lines.push(
      `> More runs exist beyond this limit. Re-run with a higher \`limit\` (max ${MAX_LIMIT}) if needed.`,
    );
  }
  lines.push("");
  lines.push("| Run ID | Status | Started | Finished | Result |");
  lines.push("|--------|--------|---------|----------|--------|");

  for (const run of result.runs) {
    lines.push(
      `| \`${run.runId}\` | ${runStatus(run)} | ${formatEpoch(run.timestamps.createdAt)} | ${formatEpoch(run.timestamps.finishedAt ?? null)} | ${passRate(run.summary?.evaluations ?? {})} |`,
    );
  }

  lines.push("");
  lines.push(
    "> Use `platform_experiment_status <runId>` for live progress, or `platform_experiment_results <runId>` for per-row results.",
  );
  return lines.join("\n");
}
