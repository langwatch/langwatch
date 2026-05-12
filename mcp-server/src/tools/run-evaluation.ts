import { makeRequest } from "../langwatch-api.js";

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

export async function handleRunEvaluation(params: {
  slug: string;
}): Promise<string> {
  const result = (await makeRequest(
    "POST",
    `/api/evaluations/v3/${encodeURIComponent(params.slug)}/run`,
  )) as EvaluationRunResponse;

  const lines: string[] = [];
  lines.push(`Evaluation started!\n`);
  lines.push(`**Run ID**: ${result.runId}`);
  lines.push(`**Status**: ${result.status}`);
  lines.push(`**Total cells**: ${result.total}`);
  if (result.runUrl) lines.push(`**View at**: ${result.runUrl}`);
  lines.push("");
  lines.push(
    `> Use \`platform_evaluation_status\` with run ID "${result.runId}" to check progress.`,
  );

  return lines.join("\n");
}

export async function handleEvaluationStatus(params: {
  runId: string;
}): Promise<string> {
  const status = (await makeRequest(
    "GET",
    `/api/evaluations/v3/runs/${encodeURIComponent(params.runId)}`,
  )) as EvaluationStatusResponse;

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
