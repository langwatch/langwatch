import { LangWatchApiError, makeRequest } from "../langwatch-api.js";
import { deriveRunStatus } from "./experiment-run-status.js";

interface EvaluationRunResponse {
  runId: string;
  status: string;
  total: number;
  runUrl?: string;
}

interface EvaluationStatusResponse {
  runId: string;
  status: string;
  progress: number;
  total: number;
  startedAt?: number;
  finishedAt?: number;
  summary?: {
    totalCells?: number;
    completedCells?: number;
    failedCells?: number;
    duration?: number;
    runUrl?: string;
  };
}

export async function handleRunExperiment(params: {
  slug: string;
}): Promise<string> {
  const result = (await makeRequest(
    "POST",
    `/api/experiments/${encodeURIComponent(params.slug)}/run`,
  )) as EvaluationRunResponse;

  const lines: string[] = [];
  lines.push(`Evaluation started!\n`);
  lines.push(`**Run ID**: ${result.runId}`);
  lines.push(`**Status**: ${result.status}`);
  lines.push(`**Total cells**: ${result.total}`);
  if (result.runUrl) lines.push(`**View at**: ${result.runUrl}`);
  lines.push("");
  lines.push(
    `> Use \`platform_experiment_status\` with run ID "${result.runId}" to check progress.`,
  );

  return lines.join("\n");
}

interface ResultsForStatus {
  progress?: number | null;
  total?: number | null;
  dataset?: unknown[];
  timestamps: {
    createdAt?: number | null;
    updatedAt?: number | null;
    finishedAt?: number | null;
    stoppedAt?: number | null;
  };
}

// SDK-logged runs (langwatch.experiment + evaluation.log) never populate the
// Redis run-state that GET /runs/:runId reads, so that endpoint 404s for them.
// Their data lives only in ClickHouse, reachable through the results endpoint,
// so we derive the status from there as a fallback. experimentSlug is required
// because runId is not unique across experiments once the Redis state expires.
async function statusFromResults(params: {
  runId: string;
  experimentSlug?: string;
}): Promise<string | null> {
  const search = new URLSearchParams();
  if (params.experimentSlug) search.set("experimentSlug", params.experimentSlug);
  const qs = search.toString() ? `?${search.toString()}` : "";

  let results: ResultsForStatus;
  try {
    results = (await makeRequest(
      "GET",
      `/api/experiments/runs/${encodeURIComponent(params.runId)}/results${qs}`,
    )) as ResultsForStatus;
  } catch (error) {
    // Only a genuine "no such run" is a fallback miss (-> guidance). Real
    // 5xx / auth / network errors must propagate, not be masked as not-found.
    const code = error instanceof LangWatchApiError ? error.status : undefined;
    const message = error instanceof Error ? error.message : String(error);
    if (code === 404 || (code === undefined && /404|not found/i.test(message))) {
      return null;
    }
    throw error;
  }

  const status = deriveRunStatus(results.timestamps);
  const total = results.total ?? results.dataset?.length ?? 0;
  const progress = results.progress ?? results.dataset?.length ?? 0;

  const lines: string[] = [];
  lines.push(`# Evaluation Run ${params.runId}\n`);
  lines.push(`**Status**: ${status}`);
  lines.push(`**Progress**: ${progress}/${total} cells`);
  if (results.timestamps.createdAt) {
    lines.push(
      `**Started**: ${new Date(results.timestamps.createdAt).toISOString()}`,
    );
  }
  if (results.timestamps.finishedAt) {
    lines.push(
      `**Finished**: ${new Date(results.timestamps.finishedAt).toISOString()}`,
    );
  }
  if (results.timestamps.stoppedAt) {
    lines.push(
      `**Stopped**: ${new Date(results.timestamps.stoppedAt).toISOString()}`,
    );
  }
  lines.push("");
  lines.push(
    "> Use `platform_experiment_results` to fetch the per-row scores (partial results are available even while running).",
  );
  return lines.join("\n");
}

export async function handleExperimentStatus(params: {
  runId: string;
  experimentSlug?: string;
}): Promise<string> {
  let status: EvaluationStatusResponse;
  try {
    status = (await makeRequest(
      "GET",
      `/api/experiments/runs/${encodeURIComponent(params.runId)}`,
    )) as EvaluationStatusResponse;
  } catch (error) {
    const code =
      error instanceof LangWatchApiError ? error.status : undefined;
    const message = error instanceof Error ? error.message : String(error);
    if (code === 404 || /404|not found/i.test(message)) {
      const fallback = await statusFromResults(params);
      if (fallback) return fallback;
      return [
        `# Evaluation Run ${params.runId}`,
        "",
        "**Status**: not found",
        "",
        `Could not find run \`${params.runId}\`. SDK-logged runs and runs older than 24h are not in the live run-state and must be resolved by experiment slug.`,
        "",
        "> Pass `experimentSlug`: discover it with `platform_experiment_list`, then use `platform_experiment_list_runs` for the run ids. Or fetch the rows directly with `platform_experiment_results`.",
      ].join("\n");
    }
    throw error;
  }

  const lines: string[] = [];
  lines.push(`# Evaluation Run ${status.runId}\n`);
  lines.push(`**Status**: ${status.status}`);
  lines.push(`**Progress**: ${status.progress}/${status.total} cells`);

  if (status.startedAt) {
    lines.push(`**Started**: ${new Date(status.startedAt).toISOString()}`);
  }
  if (status.finishedAt) {
    lines.push(`**Finished**: ${new Date(status.finishedAt).toISOString()}`);
  }

  if (status.summary) {
    lines.push("\n## Summary\n");
    if (status.summary.completedCells !== undefined) {
      lines.push(`**Completed**: ${status.summary.completedCells}`);
    }
    if (status.summary.failedCells) {
      lines.push(`**Failed**: ${status.summary.failedCells}`);
    }
    if (status.summary.duration) {
      lines.push(
        `**Duration**: ${(status.summary.duration / 1000).toFixed(1)}s`,
      );
    }
    if (status.summary.runUrl) {
      lines.push(`**View results**: ${status.summary.runUrl}`);
    }
  }

  return lines.join("\n");
}
