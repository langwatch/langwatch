/**
 * The tool half of the Claude Code join: the shapes a tool event log and a tool span arrive in,
 * and how a decision and a result become one span's input and output. The join is exact, both
 * sides carrying the tool use id, so nothing here pairs by position.
 */

import type { SpanInputOutput, TraceCanonicalisationService } from "@langwatch/trace-contract";
import { INPUT_BODY_EVENT, type ClaudeContentLog } from "./claude-code-message-index.rules";
import { capPayloadString } from "./trace-payload-cap.rules";

/** A claude_code tool event log (`tool_decision` / `tool_result`), normalized. */
export interface ClaudeToolLog {
  /** `tool_decision` | `tool_result` */
  eventName: string;
  toolUseId: string | null;
  toolName: string | null;
  /** Claude's derived params JSON (both events). */
  toolParameters: string | null;
  /** The REAL tool input JSON (`tool_result` only). */
  toolInput: string | null;
  /** `tool_decision`'s accept/reject verdict. */
  decision: string | null;
  /** Who decided (`config`, `user_permanent`, ...). */
  decisionSource: string | null;
  /** `tool_result`'s success flag (string "true"/"false" in CH). */
  success: boolean | null;
  durationMs: number | null;
  resultSizeBytes: number | null;
  timeUnixMs: number;
}

/** A tool span (`claude_code.tool` / `.execution`), normalized by the caller. */
export interface ClaudeToolSpanRef {
  spanId: string;
  toolUseId: string;
}

export interface ClaudeToolSpanEnrichment {
  input: SpanInputOutput | null;
  output: SpanInputOutput | null;
}

export const TOOL_DECISION_EVENT = "tool_decision";
export const TOOL_RESULT_EVENT = "tool_result";

/**
 * Harvest every request body's `tool_result` blocks into one
 * `tool_use_id` → content index (first occurrence wins — a tool result is
 * re-sent verbatim in every later turn's rolling history).
 */
export function buildToolResultContentIndex(
  contentLogs: ClaudeContentLog[],
  traceCanonicalisation: TraceCanonicalisationService,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const log of contentLogs) {
    if (log.eventName !== INPUT_BODY_EVENT || log.body === null) {
      continue;
    }

    const { toolResults } = traceCanonicalisation.deriveClaudeRequestContent({
      body: log.body,
    });
    for (const { useId, text } of toolResults) {
      if (!out.has(useId)) {
        out.set(useId, text);
      }
    }
  }

  return out;
}

export function buildToolInput({
  toolResult,
  decision,
}: {
  toolResult: ClaudeToolLog | null;
  decision: ClaudeToolLog | null;
}): SpanInputOutput | null {
  const raw =
    toolResult?.toolInput ?? toolResult?.toolParameters ?? decision?.toolParameters ?? null;
  if (raw === null || raw.length === 0) {
    return null;
  }

  return toJsonOrText(capPayloadString(raw, undefined, "tool_input"));
}

export function buildToolOutput({
  toolResult,
  decision,
  resultContent,
}: {
  toolResult: ClaudeToolLog | null;
  decision: ClaudeToolLog | null;
  resultContent: string | null;
}): SpanInputOutput | null {
  if (resultContent !== null) {
    return { type: "text", value: resultContent };
  }

  if (toolResult !== null) {
    const status =
      toolResult.success === false
        ? "failed"
        : toolResult.success === true
          ? "completed"
          : "unknown";

    return {
      type: "json",
      value: prune({
        // The telemetry states sizes and outcome, not content — this summary
        // IS the output on the light path, not a fallback for a parse miss.
        status,
        success: toolResult.success,
        durationMs: toolResult.durationMs,
        resultSizeBytes: toolResult.resultSizeBytes,
        decision: decision?.decision ?? null,
        decisionSource: decision?.decisionSource ?? toolResult.decisionSource,
      }),
    };
  }

  if (decision !== null && decision.decision === "reject") {
    // Denied tools never run: no result log ever comes.
    return {
      type: "json",
      value: prune({
        status: "rejected",
        decision: decision.decision,
        decisionSource: decision.decisionSource,
      }),
    };
  }

  return null;
}

/** Parse-or-text: valid JSON becomes a `json` payload, anything else `text`. */
export function toJsonOrText(value: string): SpanInputOutput {
  try {
    return { type: "json", value: JSON.parse(value) as object };
  } catch {
    return { type: "text", value };
  }
}

function prune<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) {
      (out as Record<string, unknown>)[k] = v;
    }
  }

  return out;
}
