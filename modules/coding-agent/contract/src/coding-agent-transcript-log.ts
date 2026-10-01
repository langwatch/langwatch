import { extractGeminiResponseText } from "./coding-agent-transcript-content.ts";
import { buildTranscriptNoteEntry } from "./coding-agent-transcript-note.ts";
import {
  type ClaimedToolCalls,
  type TranscriptLogRecord,
  fillToolCallGaps,
} from "./coding-agent-transcript-state.ts";
import { parseMaybeJson, pickNumber, pickString } from "./coding-agent-transcript-value.ts";
import type { TranscriptEntry } from "./coding-agent-transcript.ts";
import {
  WITHHELD_PROMPT_TEXT,
  normalizeEventName,
  parseMcpToolName,
  deriveConversationKey,
} from "./telemetry/coding-agent-normalization.ts";

export function collectLogEntries(
  logs: TranscriptLogRecord[],
  claimedToolCalls: ClaimedToolCalls,
): {
  entries: TranscriptEntry[];
  sessionId: string | null;
} {
  const entries: TranscriptEntry[] = [];
  let sessionId: string | null = null;

  for (const log of logs) {
    const event = normalizeEventName(pickString(log.attributes, "event.name"));
    if (event === null) continue;

    sessionId ??= deriveConversationKey(log.attributes);
    const entry = buildLogEntry({ event, log, claimedToolCalls });
    if (entry !== null) entries.push(entry);
  }

  return { entries, sessionId };
}

function buildLogEntry({
  event,
  log,
  claimedToolCalls,
}: {
  event: string;
  log: TranscriptLogRecord;
  claimedToolCalls: ClaimedToolCalls;
}): TranscriptEntry | null {
  const attrs = log.attributes;
  const atMs = log.timestampMs;

  switch (event) {
    case "user_prompt":
      return userPromptEntry(attrs, atMs);
    case "assistant_response":
      return assistantResponseEntry(attrs, atMs);
    case "api_response":
      return buildApiResponseEntry(attrs, atMs);
    case "tool_result":
      return buildToolResultEntry({ attrs, atMs, claimedToolCalls });
    case "tool_decision":
      return buildToolDecisionEntry(attrs, atMs);
    default:
      return buildTranscriptNoteEntry({ event, attrs, atMs });
  }
}

function userPromptEntry(attrs: Record<string, unknown>, atMs: number): TranscriptEntry {
  const text = pickString(attrs, "prompt");
  const chars =
    text !== null && text !== WITHHELD_PROMPT_TEXT
      ? text.length
      : (pickNumber(attrs, "prompt_length") ?? 0);

  return { kind: "user_prompt", atMs, text, chars };
}

function assistantResponseEntry(attrs: Record<string, unknown>, atMs: number): TranscriptEntry {
  return {
    kind: "assistant_message",
    atMs,
    text: pickString(attrs, "response"),
    model: pickString(attrs, "model"),
  };
}

function buildApiResponseEntry(
  attrs: Record<string, unknown>,
  atMs: number,
): TranscriptEntry | null {
  const role = pickString(attrs, "role");
  if (role !== null && role !== "main") return null;

  const text = extractGeminiResponseText(pickString(attrs, "response_text"));
  if (text === null) return null;

  return {
    kind: "assistant_message",
    atMs,
    text,
    model: pickString(attrs, "model"),
  };
}

function buildToolResultEntry({
  attrs,
  atMs,
  claimedToolCalls,
}: {
  attrs: Record<string, unknown>;
  atMs: number;
  claimedToolCalls: ClaimedToolCalls;
}): TranscriptEntry | null {
  const callId = pickString(attrs, "call_id");
  const isCodex = callId !== null && pickString(attrs, "event.name") === "codex.tool_result";
  if (isCodex) return buildCodexToolResultEntry({ attrs, atMs, callId, claimedToolCalls });

  const name = pickString(attrs, "function_name");
  if (name === null) return null;

  const decision = pickString(attrs, "decision");
  if (decision === "reject") {
    return { kind: "tool_rejected", atMs, name, reason: decision };
  }

  return {
    kind: "tool",
    atMs,
    name,
    mcpServer: parseMcpToolName(name)?.server ?? null,
    input: null,
    output: null,
    durationMs: pickNumber(attrs, "duration_ms"),
    failed: pickString(attrs, "success") === "false",
    agentId: null,
    spanId: "",
  };
}

function buildCodexToolResultEntry({
  attrs,
  atMs,
  callId,
  claimedToolCalls,
}: {
  attrs: Record<string, unknown>;
  atMs: number;
  callId: string;
  claimedToolCalls: ClaimedToolCalls;
}): TranscriptEntry | null {
  const claimed = claimedToolCalls.get(callId);
  if (claimed !== void 0) {
    fillToolCallGaps(claimed, {
      durationMs: pickNumber(attrs, "duration_ms"),
      failed: pickString(attrs, "success") === "false",
    });
    return null;
  }

  const name = pickString(attrs, "tool_name");
  if (name === null) return null;

  const mcpServer = pickString(attrs, "mcp_server");
  return {
    kind: "tool",
    atMs,
    name,
    mcpServer: mcpServer ?? parseMcpToolName(name)?.server ?? null,
    input: parseMaybeJson(pickString(attrs, "arguments")),
    output: pickString(attrs, "output"),
    durationMs: pickNumber(attrs, "duration_ms"),
    failed: pickString(attrs, "success") === "false",
    agentId: null,
    spanId: "",
  };
}

function buildToolDecisionEntry(
  attrs: Record<string, unknown>,
  atMs: number,
): TranscriptEntry | null {
  const decision = pickString(attrs, "decision");
  if (decision === null || decision === "accept") return null;

  return {
    kind: "tool_rejected",
    atMs,
    name: pickString(attrs, "tool_name"),
    reason: pickString(attrs, "source") ?? decision,
  };
}
