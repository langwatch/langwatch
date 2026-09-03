import type { TranscriptEntry } from "./coding-agent-transcript";
import {
  WITHHELD_PROMPT_TEXT,
  normalizeEventName,
  parseMcpToolName,
  resolveConversationKey,
} from "./telemetry/coding-agent-normalization";
import { geminiResponseText } from "./coding-agent-transcript-content";
import { transcriptNoteEntry } from "./coding-agent-transcript-note";
import {
  type ClaimedToolCalls,
  type TranscriptLogRecord,
  fillToolCallGaps,
} from "./coding-agent-transcript-state";
import { parseMaybeJson, readNumber, readString } from "./coding-agent-transcript-value";

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
    const event = normalizeEventName(readString(log.attributes, "event.name"));
    if (event === null) continue;

    sessionId ??= resolveConversationKey(log.attributes);
    const entry = logToEntry({ event, log, claimedToolCalls });
    if (entry !== null) entries.push(entry);
  }

  return { entries, sessionId };
}

function logToEntry({
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
      return apiResponseEntry(attrs, atMs);
    case "tool_result":
      return toolResultEntry({ attrs, atMs, claimedToolCalls });
    case "tool_decision":
      return toolDecisionEntry(attrs, atMs);
    default:
      return transcriptNoteEntry({ event, attrs, atMs });
  }
}

function userPromptEntry(attrs: Record<string, unknown>, atMs: number): TranscriptEntry {
  const text = readString(attrs, "prompt");
  const chars =
    text !== null && text !== WITHHELD_PROMPT_TEXT
      ? text.length
      : (readNumber(attrs, "prompt_length") ?? 0);

  return { kind: "user_prompt", atMs, text, chars };
}

function assistantResponseEntry(attrs: Record<string, unknown>, atMs: number): TranscriptEntry {
  return {
    kind: "assistant_message",
    atMs,
    text: readString(attrs, "response"),
    model: readString(attrs, "model"),
  };
}

function apiResponseEntry(attrs: Record<string, unknown>, atMs: number): TranscriptEntry | null {
  const role = readString(attrs, "role");
  if (role !== null && role !== "main") return null;

  const text = geminiResponseText(readString(attrs, "response_text"));
  if (text === null) return null;

  return {
    kind: "assistant_message",
    atMs,
    text,
    model: readString(attrs, "model"),
  };
}

function toolResultEntry({
  attrs,
  atMs,
  claimedToolCalls,
}: {
  attrs: Record<string, unknown>;
  atMs: number;
  claimedToolCalls: ClaimedToolCalls;
}): TranscriptEntry | null {
  const callId = readString(attrs, "call_id");
  const isCodex = callId !== null && readString(attrs, "event.name") === "codex.tool_result";
  if (isCodex) return codexToolResultEntry({ attrs, atMs, callId, claimedToolCalls });

  const name = readString(attrs, "function_name");
  if (name === null) return null;

  const decision = readString(attrs, "decision");
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
    durationMs: readNumber(attrs, "duration_ms"),
    failed: readString(attrs, "success") === "false",
    agentId: null,
    spanId: "",
  };
}

function codexToolResultEntry({
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
      durationMs: readNumber(attrs, "duration_ms"),
      failed: readString(attrs, "success") === "false",
    });
    return null;
  }

  const name = readString(attrs, "tool_name");
  if (name === null) return null;

  const mcpServer = readString(attrs, "mcp_server");
  return {
    kind: "tool",
    atMs,
    name,
    mcpServer: mcpServer ?? parseMcpToolName(name)?.server ?? null,
    input: parseMaybeJson(readString(attrs, "arguments")),
    output: readString(attrs, "output"),
    durationMs: readNumber(attrs, "duration_ms"),
    failed: readString(attrs, "success") === "false",
    agentId: null,
    spanId: "",
  };
}

function toolDecisionEntry(attrs: Record<string, unknown>, atMs: number): TranscriptEntry | null {
  const decision = readString(attrs, "decision");
  if (decision === null || decision === "accept") return null;

  return {
    kind: "tool_rejected",
    atMs,
    name: readString(attrs, "tool_name"),
    reason: readString(attrs, "source") ?? decision,
  };
}
