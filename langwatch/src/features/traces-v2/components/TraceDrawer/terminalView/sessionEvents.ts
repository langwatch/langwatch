import type { TraceLogRecordDto } from "~/server/api/routers/tracesV2";

/**
 * The parts of a session that exist ONLY as logs.
 *
 * A trace is spans AND logs, and they complement each other rather than
 * duplicate: the spans carry the structure (what ran, how long, what it cost),
 * but a whole class of things never produces a span at all —
 *
 * - `tool_decision` with `decision: "reject"` — a tool the user DENIED. It never
 *   ran, so there is no tool span and no result. Without the logs, a denied tool
 *   is simply missing from the trace, and the turn looks like the model just
 *   changed its mind.
 * - `api_error` / `api_retries_exhausted` — model calls that failed, and how many
 *   times they were retried.
 * - `api_refusal` — the model refused.
 * - `compaction` — the conversation was compacted mid-session, with the token
 *   count before and after.
 *
 * These are the interesting moments, and they were invisible. Reading them is
 * what makes the drawer show the session rather than a redacted version of it.
 */
const TOOL_DECISION_EVENT = "tool_decision";
const API_ERROR_EVENT = "api_error";
const RETRIES_EXHAUSTED_EVENT = "api_retries_exhausted";
const REFUSAL_EVENT = "api_refusal";
const COMPACTION_EVENT = "compaction";

/** A tool the user denied. Keyed by `tool_use_id` so it lands on the exact call. */
export interface ToolRejection {
  toolName: string | null;
  /** "user_reject", "user_abort", "config", "hook", … */
  source: string | null;
}

/** A turn-level fact with no span of its own. */
export interface SessionNote {
  kind: "error" | "refusal" | "compaction";
  timeUnixMs: number;
  text: string;
}

export interface SessionEvents {
  rejectionsByToolUseId: Map<string, ToolRejection>;
  notes: SessionNote[];
}

function attr(log: TraceLogRecordDto, key: string): string | null {
  const value = log.attributes?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function deriveSessionEvents(
  logs: TraceLogRecordDto[],
): SessionEvents {
  const rejectionsByToolUseId = new Map<string, ToolRejection>();
  const notes: SessionNote[] = [];

  for (const log of logs) {
    const event = attr(log, "event.name");
    if (event === null) continue;

    if (event === TOOL_DECISION_EVENT) {
      // Only rejections are worth surfacing: an accepted decision is already
      // evidenced by the tool span that followed it.
      if (attr(log, "decision") !== "reject") continue;
      const toolUseId = attr(log, "tool_use_id");
      if (toolUseId === null) continue;
      rejectionsByToolUseId.set(toolUseId, {
        toolName: attr(log, "tool_name"),
        source: attr(log, "source"),
      });
      continue;
    }

    if (event === API_ERROR_EVENT) {
      const status = attr(log, "status_code");
      const message = attr(log, "error") ?? "API error";
      notes.push({
        kind: "error",
        timeUnixMs: log.timeUnixMs,
        text: status !== null ? `${status} — ${message}` : message,
      });
      continue;
    }

    if (event === RETRIES_EXHAUSTED_EVENT) {
      const attempts = attr(log, "total_attempts");
      notes.push({
        kind: "error",
        timeUnixMs: log.timeUnixMs,
        text: `Retries exhausted after ${attempts ?? "several"} attempts`,
      });
      continue;
    }

    if (event === REFUSAL_EVENT) {
      notes.push({
        kind: "refusal",
        timeUnixMs: log.timeUnixMs,
        text: "The model refused this request",
      });
      continue;
    }

    if (event === COMPACTION_EVENT) {
      const pre = attr(log, "pre_tokens");
      const post = attr(log, "post_tokens");
      const trigger = attr(log, "trigger");
      notes.push({
        kind: "compaction",
        timeUnixMs: log.timeUnixMs,
        text:
          pre !== null && post !== null
            ? `Context compacted (${trigger ?? "auto"}): ${formatCount(pre)} → ${formatCount(post)} tokens`
            : `Context compacted (${trigger ?? "auto"})`,
      });
    }
  }

  notes.sort((a, b) => a.timeUnixMs - b.timeUnixMs);
  return { rejectionsByToolUseId, notes };
}

function formatCount(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}
