import { getTraceById as apiGetTraceById } from "../langwatch-api.js";

/**
 * Handles the get_trace MCP tool invocation.
 *
 * Retrieves a single trace by ID. In digest mode (default), returns the
 * AI-readable formatted digest. In json mode, returns the full raw JSON.
 */
export async function handleGetTrace(params: {
  traceId: string;
  format?: "digest" | "json";
}): Promise<string> {
  const format = params.format ?? "digest";
  const result = await apiGetTraceById(params.traceId, format);

  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];
  lines.push(`# Trace: ${params.traceId}\n`);

  if (result.timestamps) {
    lines.push(`**Started**: ${result.timestamps.started_at}`);
    if (result.timestamps.updated_at)
      lines.push(`**Updated**: ${result.timestamps.updated_at}`);
  }

  if (result.metadata) {
    const meta = result.metadata;
    if (meta.user_id) lines.push(`**User**: ${meta.user_id}`);
    if (meta.thread_id) lines.push(`**Thread**: ${meta.thread_id}`);
    if (meta.customer_id) lines.push(`**Customer**: ${meta.customer_id}`);
    if (meta.labels?.length) lines.push(`**Labels**: ${meta.labels.join(", ")}`);
  }

  if (result.evaluations && result.evaluations.length > 0) {
    lines.push("\n## Evaluations");
    for (const evaluation of result.evaluations) {
      const status =
        evaluation.passed === true
          ? "PASSED"
          : evaluation.passed === false
            ? "FAILED"
            : "N/A";
      lines.push(
        `- **${evaluation.name || evaluation.evaluator_id}**: ${status}${evaluation.score != null ? ` (score: ${evaluation.score})` : ""}${evaluation.label ? ` [${evaluation.label}]` : ""}`
      );
    }
  }

  if (result.formatted_trace) {
    lines.push(`\n## Trace Details\n${result.formatted_trace}`);
  }

  lines.push(
    '\n> Tip: Use `get_trace` with `format: "json"` to get the full raw trace data.'
  );

  return lines.join("\n");
}
