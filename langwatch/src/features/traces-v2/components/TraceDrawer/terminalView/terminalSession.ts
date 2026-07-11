import type { TranscriptEntry } from "~/server/app-layer/traces/coding-agent-transcript.derivation";

/**
 * Running totals at each point in the transcript, so scrubbing to entry _k_
 * can show the cost/tokens/elapsed accumulated up to and including it — the
 * "watch the cost tick up as you travel through time" HUD.
 *
 * Built over the FULL entry list, including `model_call` entries (which carry
 * economics but render nothing) — so the totals advance at the exact point in
 * the sequence the model call actually happened, not just at the visible
 * beats around it.
 */
export interface TimelinePoint {
  index: number;
  cumulativeTokens: number;
  cumulativeCostUsd: number;
  /** Milliseconds since the first entry. */
  elapsedMs: number;
}

export function buildEntryTimeline(entries: TranscriptEntry[]): TimelinePoint[] {
  const startMs = entries[0]?.atMs;
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
      elapsedMs: startMs != null ? entry.atMs - startMs : 0,
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
const DIFF_TOOLS = new Set([
  "edit",
  "write",
  "multiedit",
  "str_replace",
  "create",
]);

export function isDiffTool(name: string): boolean {
  return DIFF_TOOLS.has(name.toLowerCase());
}

/**
 * Pull the before/after text for a diff-style tool call out of its input.
 * Handles Edit (`old_string`/`new_string`), Write (`content`, all additions),
 * and the common `file_path` carrier. Returns null when the shape doesn't
 * carry a diffable pair.
 */
export function extractDiffFromToolInput(input: unknown): {
  oldText: string;
  newText: string;
  filePath?: string;
} | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  const filePath =
    typeof obj.file_path === "string"
      ? obj.file_path
      : typeof obj.path === "string"
        ? obj.path
        : undefined;

  const oldString = typeof obj.old_string === "string" ? obj.old_string : null;
  const newString = typeof obj.new_string === "string" ? obj.new_string : null;
  if (oldString != null && newString != null) {
    return { oldText: oldString, newText: newString, filePath };
  }

  // Write / create: whole file content is one big addition.
  const content =
    typeof obj.content === "string"
      ? obj.content
      : typeof obj.file_text === "string"
        ? obj.file_text
        : null;
  if (content != null) {
    return { oldText: "", newText: content, filePath };
  }
  return null;
}
