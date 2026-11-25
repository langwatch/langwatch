import type { SpanDetail } from "@langwatch/trace-contract";

/**
 * Tool spans with per-tool attributes (verified against CLI bundle) plus timing
 * and failure info; better than re-deriving from model message history.
 */
const TOOL_SPAN = "claude_code.tool";
const TOOL_EXECUTION_SPAN = "claude_code.tool.execution";
const TOOL_OUTPUT_EVENT = "tool.output";

export interface TerminalToolSpan {
  toolName: string | null;
  durationMs: number;
  isError: boolean;
  resultTokens: number | null;
  filePath: string | null;
  bashCommand: string | null;
  /** Bash stdout. */
  output: string | null;
  /** File content (Read / Write). */
  content: string | null;
  /** Edit's structured patch, as the CLI serialized it. */
  diff: string | null;
}

/** One hunk of Claude Code's structured patch. */
export interface PatchHunk {
  oldStart: number;
  newStart: number;
  lines: string[];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Index tool spans by span id for transcript matching; keyed by span id since
 * not every agent's span carries model-issued call id.
 */
export function indexToolSpansBySpanId({
  spans,
  events,
}: {
  spans: SpanDetail[];
  events: {
    spanId: string;
    name: string;
    attributes: Record<string, string>;
  }[];
}): Map<string, TerminalToolSpan> {
  const outputBySpanId = new Map<string, Record<string, string>>();
  for (const event of events) {
    if (event.name === TOOL_OUTPUT_EVENT) {
      outputBySpanId.set(event.spanId, event.attributes);
    }
  }

  // A failing tool body shows up on the `tool.execution` child, not the parent.
  const failedParents = new Set<string>();
  for (const span of spans) {
    if (
      span.name === TOOL_EXECUTION_SPAN &&
      span.parentSpanId !== null &&
      (span.status === "error" || span.params?.success === "false")
    ) {
      failedParents.add(span.parentSpanId);
    }
  }

  const bySpanId = new Map<string, TerminalToolSpan>();
  for (const span of spans) {
    if (span.name !== TOOL_SPAN) continue;

    const params = span.params ?? {};
    // The event can land on the tool span or on its execution child.
    const attrs =
      outputBySpanId.get(span.spanId) ??
      childOutput({ spans, events: outputBySpanId, parentSpanId: span.spanId });

    const resultTokens = Number(params.result_tokens);

    bySpanId.set(span.spanId, {
      toolName: str(params.tool_name),
      durationMs: span.durationMs,
      isError: span.status === "error" || failedParents.has(span.spanId),
      resultTokens: Number.isFinite(resultTokens) ? resultTokens : null,
      filePath: str(attrs?.file_path) ?? str(params.file_path),
      bashCommand: str(attrs?.bash_command) ?? str(params.full_command),
      output: str(attrs?.output),
      content: str(attrs?.content),
      diff: str(attrs?.diff),
    });
  }
  return bySpanId;
}

function childOutput({
  spans,
  events,
  parentSpanId,
}: {
  spans: SpanDetail[];
  events: Map<string, Record<string, string>>;
  parentSpanId: string;
}): Record<string, string> | undefined {
  for (const span of spans) {
    if (span.parentSpanId !== parentSpanId) continue;
    const attrs = events.get(span.spanId);
    if (attrs) return attrs;
  }
  return undefined;
}

/**
 * Parse Edit's `diff` attribute into hunks. Claude serializes a structured
 * jsdiff-shaped patch — the real change, not a synthesized `old_string` →
 * `new_string` diff. Returns null on anything unexpected, shown as raw text.
 */
export function parsePatchHunks(diff: string | null): PatchHunk[] | null {
  if (diff === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(diff);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const hunks: PatchHunk[] = [];
  for (const raw of parsed) {
    if (typeof raw !== "object" || raw === null) return null;
    const hunk = raw as Record<string, unknown>;
    const lines = hunk.lines;
    if (!Array.isArray(lines) || !lines.every((l) => typeof l === "string")) {
      return null;
    }
    hunks.push({
      oldStart: Number(hunk.oldStart) || 0,
      newStart: Number(hunk.newStart) || 0,
      lines: lines as string[],
    });
  }
  return hunks.length > 0 ? hunks : null;
}
