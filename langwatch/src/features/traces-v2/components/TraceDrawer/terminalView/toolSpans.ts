import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";

/**
 * Claude Code's real tool span, and the `tool.output` span event it carries
 * when `OTEL_LOG_TOOL_CONTENT=1`.
 *
 * The event's attributes are per-tool (verified against the CLI bundle):
 *
 *   Bash   → `bash_command`, `output`   (stdout)
 *   Read   → `file_path`,   `content`   (the file that was read)
 *   Write  → `file_path`,   `content`   (what was written)
 *   Edit   → `file_path`,   `diff`      (a REAL structured patch)
 *
 * This is strictly better than re-deriving tool I/O from the model's message
 * history: the history holds what the model was *told* the tool returned (capped,
 * and for Edit only the `old_string`/`new_string` we'd have to diff ourselves),
 * whereas the span holds what actually happened — plus how long it took and
 * whether it failed.
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
 * Index the trace's tool spans by their OWN span id, so a `tool` entry from
 * the coding-agent transcript (which carries `spanId` directly, off the SAME
 * span this reads) can be matched to what actually ran. `tool.execution`
 * children contribute the failure signal — the outer `tool` span covers
 * permission + execution, so it can look "ok" while the body failed.
 *
 * Keyed by span id rather than `tool_use_id`: the transcript is agent-neutral
 * and not every agent's tool span carries a model-issued call id, but every
 * span has an id.
 */
export function indexToolSpansBySpanId({
  spans,
  events,
}: {
  spans: SpanDetail[];
  events: { spanId: string; name: string; attributes: Record<string, string> }[];
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
 * patch (jsdiff's shape: hunks of `+`/`-`/context lines), which is the real
 * change rather than the `old_string` → `new_string` diff we'd otherwise have
 * to synthesize. Returns null on anything unexpected — a diff we can't read is
 * shown as raw text rather than mangled.
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
