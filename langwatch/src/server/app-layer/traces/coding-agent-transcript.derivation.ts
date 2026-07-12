import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import {
  detectCodingAgent,
  normalizeEventName,
  parseMcpToolName,
  resolveConversationKey,
  resolveToolName,
  type CodingAgent,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/services/coding-agent-normalization";

/**
 * What a coding agent DID, in the order it did it — derived on the server.
 *
 * This is the transcript the Terminal view draws, and it lives here rather than
 * in the browser for one reason: it is not a rendering concern. The CLI wants it,
 * an MCP server wants it, and an export wants it, and none of them are going to
 * run React to get it. One derivation, one answer, every consumer.
 *
 * ## Why this reads spans + logs, and not the rolling message history
 *
 * The browser used to rebuild the transcript by parsing the LAST model call's
 * input — the whole conversation-so-far, which Claude Code helpfully carries on
 * every request. That worked, and it worked only for Claude Code: opencode,
 * Codex and Gemini do not send a rolling history at all, so there is nothing
 * there to parse. Ordering by timestamp across the tool spans and the log records
 * is the one method that works for every agent, and it needs no vendor-specific
 * message format.
 *
 * ## Why logs are not optional
 *
 * A tool the user DENIED never runs, so it has no span. It exists only as a
 * `tool_decision` log. Read only the spans and the transcript quietly omits every
 * moment a human said no — which is usually the moment they most want to find.
 */

/** One thing that happened, at a point in time. */
export type TranscriptEntry =
  | { kind: "user_prompt"; atMs: number; text: string | null; chars: number }
  | {
      kind: "assistant_message";
      atMs: number;
      text: string | null;
      model: string | null;
    }
  | {
      /**
       * A model call's own economics, positioned in the sequence at the moment
       * it happened. Separate from `assistant_message` (the TEXT, from the
       * logs) because the two come off different signals and only the span
       * knows the cost. Not meant to be its own line in a rendered transcript —
       * it exists so a reader scrubbing the session can see tokens/cost
       * accumulate at the right point without re-deriving it from spans.
       */
      kind: "model_call";
      atMs: number;
      model: string | null;
      tokens: number;
      costUsd: number;
      durationMs: number | null;
      spanId: string;
      /**
       * The cache split, not just the total — this is what lets a reader spot
       * WHICH call re-created the cache instead of reading from it. A cache
       * read bills at a fraction of fresh input; a cache write costs MORE than
       * it, so a call with a large `cacheCreationTokens` next to a small
       * `cacheReadTokens` is the session paying twice for the same context.
       */
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
    }
  | {
      kind: "tool";
      atMs: number;
      name: string;
      /** Set when the tool came from an MCP server, e.g. `claude-in-chrome`. */
      mcpServer: string | null;
      input: unknown;
      output: unknown;
      durationMs: number | null;
      failed: boolean;
      /** Present when a SUB-AGENT ran this tool, not the main thread. */
      agentId: string | null;
      spanId: string;
    }
  | {
      /** A tool that never ran: the human said no, or walked away. */
      kind: "tool_rejected";
      atMs: number;
      name: string | null;
      /** `reject` (said no) vs `user_abort` (stopped it mid-flight). */
      reason: string | null;
    }
  | {
      /** Something happened TO the session: compaction, an error, a rate limit. */
      kind: "note";
      atMs: number;
      level: "info" | "warning" | "error";
      event: string;
      text: string;
    };

export interface CodingAgentTranscript {
  agent: CodingAgent;
  /** The agent's own session id — the key that reaches its other traces. */
  sessionId: string | null;
  entries: TranscriptEntry[];
  totals: {
    modelCalls: number;
    toolCalls: number;
    tokens: number;
    costUsd: number;
  };
  /** Sub-agents that ran, by their id, with how many tools each one used. */
  subAgents: Array<{ agentId: string; toolCalls: number }>;
}

/** The log record shape this derivation needs. Structural, so callers can pass their own. */
export interface TranscriptLogRecord {
  timestampMs: number;
  attributes: Record<string, unknown>;
}

const TOOL_SPAN_NAMES = new Set([
  "claude_code.tool",
  // opencode encodes the tool in the span name, so it is matched by prefix below.
]);

const MODEL_CALL_SPAN_NAMES = new Set([
  "claude_code.llm_request",
  "opencode.llm",
  "chat",
]);

export function buildCodingAgentTranscript({
  spans,
  logs,
}: {
  spans: SpanDetail[];
  logs: TranscriptLogRecord[];
}): CodingAgentTranscript {
  const entries: TranscriptEntry[] = [];

  const agent = detectAgentFrom({ spans, logs });
  let sessionId: string | null = null;

  const subAgentToolCounts = new Map<string, number>();
  let modelCalls = 0;
  let toolCalls = 0;
  let tokens = 0;
  let costUsd = 0;

  for (const span of spans) {
    if (isModelCallSpan(span.name)) {
      modelCalls += 1;
      const callTokens =
        (span.metrics?.promptTokens ?? 0) + (span.metrics?.completionTokens ?? 0);
      const callCostUsd = span.metrics?.cost ?? 0;
      tokens += callTokens;
      costUsd += callCostUsd;
      entries.push({
        kind: "model_call",
        atMs: span.startTimeMs,
        model:
          readString(span.params, "gen_ai.request.model") ??
          readString(span.params, "model"),
        tokens: callTokens,
        costUsd: callCostUsd,
        durationMs:
          span.endTimeMs && span.startTimeMs
            ? span.endTimeMs - span.startTimeMs
            : null,
        spanId: span.spanId,
        inputTokens: readNumber(span.params, "input_tokens") ?? 0,
        outputTokens: readNumber(span.params, "output_tokens") ?? 0,
        cacheReadTokens: readNumber(span.params, "cache_read_tokens") ?? 0,
        cacheCreationTokens: readNumber(span.params, "cache_creation_tokens") ?? 0,
      });
      continue;
    }

    const toolName = resolveToolName({
      spanName: span.name,
      attrs: (span.params ?? {}) as Record<string, unknown>,
    });
    if (!isToolSpan(span.name) || toolName === null) continue;

    toolCalls += 1;

    // A sub-agent's tools are kept IN the sequence but marked, rather than
    // hoisted out of it. Dropping them lost the work entirely; flattening them
    // into the main thread pretended the main thread did it.
    const agentId = readString(span.params, "agent_id");
    if (agentId !== null) {
      subAgentToolCounts.set(agentId, (subAgentToolCounts.get(agentId) ?? 0) + 1);
    }

    entries.push({
      kind: "tool",
      atMs: span.startTimeMs,
      name: toolName,
      mcpServer: parseMcpToolName(toolName)?.server ?? null,
      input: span.input ?? null,
      output: span.output ?? null,
      durationMs:
        span.endTimeMs && span.startTimeMs
          ? span.endTimeMs - span.startTimeMs
          : null,
      // Both signals, because they are set independently: a span can carry an
      // error payload, or simply an error STATUS with no payload at all.
      failed: span.status === "error" || span.error != null,
      agentId,
      spanId: span.spanId,
    });
  }

  for (const log of logs) {
    const event = normalizeEventName(readString(log.attributes, "event.name"));
    if (event === null) continue;

    sessionId ??= resolveConversationKey(log.attributes);

    const entry = logToEntry({ event, log });
    if (entry !== null) entries.push(entry);
  }

  // Time is the only ordering every agent agrees on. Spans and logs arrive on
  // separate exporters and separate batches, so neither stream's arrival order
  // says anything about what actually happened first.
  entries.sort((a, b) => a.atMs - b.atMs);

  return {
    agent,
    sessionId,
    entries,
    totals: { modelCalls, toolCalls, tokens, costUsd },
    subAgents: [...subAgentToolCounts.entries()]
      .map(([agentId, count]) => ({ agentId, toolCalls: count }))
      .sort((a, b) => b.toolCalls - a.toolCalls),
  };
}

function logToEntry({
  event,
  log,
}: {
  event: string;
  log: TranscriptLogRecord;
}): TranscriptEntry | null {
  const attrs = log.attributes;
  const atMs = log.timestampMs;

  switch (event) {
    case "user_prompt": {
      const text = readString(attrs, "prompt");
      return {
        kind: "user_prompt",
        atMs,
        text,
        chars: text?.length ?? readNumber(attrs, "prompt_length") ?? 0,
      };
    }

    case "assistant_response":
      return {
        kind: "assistant_message",
        atMs,
        text: readString(attrs, "response"),
        model: readString(attrs, "model"),
      };

    case "tool_decision": {
      // The ONLY record of a tool the human refused: it never ran, so no span
      // for it exists anywhere in the trace.
      const decision = readString(attrs, "decision");
      if (decision === null || decision === "accept") return null;
      return {
        kind: "tool_rejected",
        atMs,
        name: readString(attrs, "tool_name"),
        reason: readString(attrs, "source") ?? decision,
      };
    }

    case "compaction": {
      const pre = readNumber(attrs, "pre_tokens");
      const post = readNumber(attrs, "post_tokens");
      const trigger = readString(attrs, "trigger") ?? "auto";
      return {
        kind: "note",
        atMs,
        level: "info",
        event,
        text:
          pre !== null && post !== null
            ? `Context compacted (${trigger}): ${formatTokenCount(pre)} → ${formatTokenCount(post)} tokens`
            : `Context compacted (${trigger})`,
      };
    }

    case "permission_mode_changed":
      return {
        kind: "note",
        atMs,
        level: "warning",
        event,
        text: `Approval mode changed to ${readString(attrs, "to_mode") ?? "unknown"}.`,
      };

    case "api_error": {
      const status = readString(attrs, "status_code");
      return {
        kind: "note",
        atMs,
        level: "error",
        event,
        // A 429 is worth telling apart from every other failure: it is time
        // spent waiting, not working.
        text:
          status === "429"
            ? "Rate limited by the provider."
            : `The request failed${status ? ` (${status})` : ""}.`,
      };
    }

    case "retries_exhausted":
      return {
        kind: "note",
        atMs,
        level: "error",
        event,
        text: "Gave up after retrying — whatever this was doing did not happen.",
      };

    case "session_error":
    case "internal_error":
      return {
        kind: "note",
        atMs,
        level: "error",
        event,
        text: readString(attrs, "error") ?? "The session hit an error.",
      };

    default:
      return null;
  }
}

function detectAgentFrom({
  spans,
  logs,
}: {
  spans: SpanDetail[];
  logs: TranscriptLogRecord[];
}): CodingAgent {
  for (const span of spans) {
    const agent = detectCodingAgent({ recordName: span.name });
    if (agent !== "unknown") return agent;
  }
  for (const log of logs) {
    const agent = detectCodingAgent({
      recordName: readString(log.attributes, "event.name"),
    });
    if (agent !== "unknown") return agent;
  }
  return "unknown";
}

function isToolSpan(spanName: string): boolean {
  return TOOL_SPAN_NAMES.has(spanName) || spanName.startsWith("opencode.tool.");
}

function isModelCallSpan(spanName: string): boolean {
  return MODEL_CALL_SPAN_NAMES.has(spanName);
}

function readString(
  attrs: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = attrs?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(
  attrs: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = attrs?.[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatTokenCount(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}
