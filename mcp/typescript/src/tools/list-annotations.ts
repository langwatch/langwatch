import {
  listAnnotations as apiListAnnotations,
  getAnnotationsByTrace as apiGetByTrace,
} from "../langwatch-api-annotations.js";

export async function handleListAnnotations(params: {
  traceId?: string;
}): Promise<string> {
  const annotations = params.traceId
    ? await apiGetByTrace(params.traceId)
    : await apiListAnnotations();

  if (!Array.isArray(annotations) || annotations.length === 0) {
    return params.traceId
      ? `No annotations found for trace "${params.traceId}".\n\n> Tip: Use \`platform_create_annotation\` to annotate a trace.`
      : "No annotations found in this project.\n\n> Tip: Use `platform_create_annotation` to annotate a trace.";
  }

  const lines: string[] = [];
  lines.push(`# Annotations (${annotations.length} total)\n`);

  for (const a of annotations) {
    const rating = a.isThumbsUp === true ? "👍" : a.isThumbsUp === false ? "👎" : "—";
    lines.push(`## Annotation ${a.id ?? "—"}`);
    lines.push(`**Trace ID**: ${a.traceId ?? "—"}`);
    lines.push(`**Rating**: ${rating}`);
    if (a.comment) lines.push(`**Comment**: ${a.comment}`);
    if (a.email) lines.push(`**By**: ${a.email}`);
    lines.push("");
  }

  return lines.join("\n");
}
