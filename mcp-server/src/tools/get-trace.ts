import { getTraceById as apiGetTraceById } from "../langwatch-api.js";

/**
 * Handles the get_trace MCP tool invocation.
 *
 * Retrieves a single trace by ID and formats it as AI-readable markdown,
 * including span tree, inputs/outputs, evaluations, and metadata.
 */
export async function handleGetTrace(params: {
  traceId: string;
}): Promise<string> {
  const result = await apiGetTraceById(params.traceId);

  const lines: string[] = [];
  lines.push(`# Trace: ${params.traceId}\n`);

  if (result.timestamps) {
    lines.push(`**Started**: ${result.timestamps.started_at}`);
    lines.push(`**Updated**: ${result.timestamps.updated_at}`);
  }

  if (result.metadata) {
    const meta = result.metadata;
    if (meta.user_id) lines.push(`**User**: ${meta.user_id}`);
    if (meta.thread_id) lines.push(`**Thread**: ${meta.thread_id}`);
    if (meta.customer_id) lines.push(`**Customer**: ${meta.customer_id}`);
    if (meta.labels?.length) lines.push(`**Labels**: ${meta.labels.join(", ")}`);
  }

  if (result.input?.value) {
    lines.push(`\n## Input\n${result.input.value}`);
  }
  if (result.output?.value) {
    lines.push(`\n## Output\n${result.output.value}`);
  }
  if (result.error) {
    lines.push(`\n## Error\n${JSON.stringify(result.error, null, 2)}`);
  }

  if (result.ascii_tree) {
    lines.push(`\n## Span Tree\n\`\`\`\n${result.ascii_tree}\`\`\``);
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

  if (result.spans && result.spans.length > 0) {
    lines.push("\n## Spans Detail");
    for (const span of result.spans) {
      lines.push(
        `\n### ${span.type || "span"}: ${span.name || span.span_id}`
      );
      if (span.model) lines.push(`- **Model**: ${span.model}`);
      if (span.input?.value)
        lines.push(
          `- **Input**: ${String(span.input.value).slice(0, 200)}${String(span.input.value).length > 200 ? "..." : ""}`
        );
      if (span.output?.value)
        lines.push(
          `- **Output**: ${String(span.output.value).slice(0, 200)}${String(span.output.value).length > 200 ? "..." : ""}`
        );
      if (span.metrics) {
        const metrics = span.metrics;
        if (metrics.completion_time_ms)
          lines.push(`- **Duration**: ${metrics.completion_time_ms}ms`);
        if (metrics.prompt_tokens)
          lines.push(
            `- **Tokens**: ${metrics.prompt_tokens} in / ${metrics.completion_tokens ?? 0} out`
          );
        if (metrics.cost) lines.push(`- **Cost**: $${metrics.cost}`);
      }
    }
  }

  return lines.join("\n");
}
