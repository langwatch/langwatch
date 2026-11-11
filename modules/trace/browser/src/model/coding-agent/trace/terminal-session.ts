import { classifyPromptText, type TranscriptEntry } from "@langwatch/coding-agent-contract";
import type { SpanDetail } from "@langwatch/trace-contract";

/** A logs-only trace is named after its id's first eight characters; a shorter name is real. */
const SHORT_TRACE_ID_LENGTH = 8;

/**
 * What the bottom bar's prompt line reads. A trace with no name of its own is named after one
 * of its spans, or after its own id on a logs-only trace. The user typed neither, so the
 * session's first prompt stands in; null when there is none, never the stand-in.
 */
export function promptLineText({
  sessionName,
  traceId,
  spans,
  entries,
}: {
  sessionName: string | null | undefined;
  traceId: string;
  spans: SpanDetail[];
  entries: TranscriptEntry[];
}): string | null {
  const name = sessionName?.trim() ?? "";
  const isIdPrefix = name.length >= SHORT_TRACE_ID_LENGTH && traceId.startsWith(name);
  const isStandIn = isIdPrefix || spans.some((span) => span.name === name);
  if (name.length > 0 && !isStandIn) return name;

  for (const entry of entries) {
    if (entry.kind !== "user_prompt" || entry.text === null) continue;
    const words = classifyPromptText(entry.text).remainder?.trim() ?? "";
    if (words.length > 0) return words;
  }
  return null;
}

/**
 * Running totals at each transcript point (cost, tokens, elapsed) for scrubbing
 * HUD; built over full entry list including invisible model_call entries.
 */
interface TimelinePoint {
  index: number;
  cumulativeTokens: number;
  cumulativeCostUsd: number;
  /** Milliseconds since the anchor, which is the first entry by default. */
  elapsedMs: number;
}

export function buildEntryTimeline({
  entries,
  startAtMs,
}: {
  entries: TranscriptEntry[];
  /**
   * Where elapsed time is measured from. The session's first turn when the
   * view knows it, so the clock reads the same wherever the loaded window
   * starts; the first loaded entry otherwise.
   */
  startAtMs?: number | null;
}): TimelinePoint[] {
  const startMs = startAtMs ?? entries[0]?.atMs;
  let cumulativeTokens = 0;
  let cumulativeCostUsd = 0;
  return entries.map((entry, index) => {
    if (entry.kind === "model_call") {
      cumulativeTokens += entry.tokens;
      cumulativeCostUsd += entry.costUsd;
    }
    return {
      index,
      cumulativeTokens,
      cumulativeCostUsd,
      elapsedMs: startMs != null ? Math.max(0, entry.atMs - startMs) : 0,
    };
  });
}

/**
 * The most identifying single argument of a tool call, used as the subtitle in
 * a `⏺ Tool(arg)` line. Mirrors the priority the transcript's ToolPairCard
 * uses so the two views agree on what a call's "primary arg" is.
 */
export function toolPrimaryArg(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return null;
  const primary =
    entries.find(
      ([key]) =>
        key === "file_path" ||
        key === "command" ||
        key === "path" ||
        key === "url" ||
        key === "query" ||
        key === "pattern",
    ) ?? entries[0]!;
  const [, value] = primary;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/** Tool names whose result is best shown as a code diff rather than raw output. */
const DIFF_TOOLS = new Set(["edit", "write", "multiedit", "str_replace", "create"]);

export function isDiffTool(name: string): boolean {
  return DIFF_TOOLS.has(name.toLowerCase());
}

/**
 * Pull the before/after text for a diff-style tool call out of its input.
 * Handles Edit (`old_string`/`new_string`), Write (`content`, all additions),
 * and `file_path`; returns null when the shape carries no diffable pair.
 */
export function extractDiffFromToolInput(input: unknown): {
  oldText: string;
  newText: string;
  filePath?: string;
} | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  const filePath = [obj.file_path, obj.path].find(
    (candidate): candidate is string => typeof candidate === "string",
  );

  const oldString = typeof obj.old_string === "string" ? obj.old_string : null;
  const newString = typeof obj.new_string === "string" ? obj.new_string : null;
  if (oldString != null && newString != null) {
    return { oldText: oldString, newText: newString, filePath };
  }

  // Write / create: whole file content is one big addition.
  const content =
    [obj.content, obj.file_text].find(
      (candidate): candidate is string => typeof candidate === "string",
    ) ?? null;
  if (content != null) {
    return { oldText: "", newText: content, filePath };
  }
  return null;
}
