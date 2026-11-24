import { extractGeminiResponseText } from "./coding-agent-transcript-content.ts";
import { buildTranscriptNoteEntry } from "./coding-agent-transcript-note.ts";
import {
  type ClaimedToolCalls,
  type TranscriptLogRecord,
  fillToolCallGaps,
} from "./coding-agent-transcript-state.ts";
import { parseMaybeJson, pickNumber } from "./coding-agent-transcript-value.ts";
import type { TranscriptEntry } from "./coding-agent-transcript.ts";
import {
  WITHHELD_PROMPT_TEXT,
  normalizeEventName,
  parseMcpToolName,
  deriveConversationKey,
  readDeclaredSessionKey,
  classifyToolCall,
  unwrapUserQuery,
  isUtilityQuerySource,
} from "./telemetry/coding-agent-normalization.ts";
import { pickString } from "./telemetry/coding-agent-span.ts";
import { grokAgent } from "./telemetry/grok.ts";
import { toolDecisionByUser, toolDecisionOutcome } from "./telemetry/tool-decision.ts";

export function collectLogEntries(
  logs: TranscriptLogRecord[],
  claimedToolCalls: ClaimedToolCalls,
): {
  entries: TranscriptEntry[];
  sessionId: string | null;
} {
  const entries: TranscriptEntry[] = [];
  const seenScriptCalls = new Set<string>();
  let sessionId: string | null = null;

  for (const log of logs) {
    const event = normalizeEventName(pickString(log.attributes, "event.name"));
    if (event === null) continue;

    sessionId ??=
      readDeclaredSessionKey({
        attributes: log.attributes,
        resourceAttributes: log.resourceAttributes ?? null,
      }) ?? deriveConversationKey(log.attributes);
    const entry = buildLogEntry({ event, log, claimedToolCalls, seenScriptCalls });
    if (entry !== null) entries.push(entry);
  }

  return { entries, sessionId };
}

function buildLogEntry({
  event,
  log,
  claimedToolCalls,
  seenScriptCalls,
}: {
  event: string;
  log: TranscriptLogRecord;
  claimedToolCalls: ClaimedToolCalls;
  seenScriptCalls: Set<string>;
}): TranscriptEntry | null {
  const attrs = log.attributes;
  const atMs = log.timestampMs;

  switch (event) {
    case "user_prompt":
      return userPromptEntry(attrs, atMs);
    case "assistant_response":
      return isUtilityQuerySource(attrs) ? null : assistantResponseEntry(attrs, atMs);
    case "api_response":
      return buildApiResponseEntry(attrs, atMs);
    case "tool_result":
      return buildToolResultEntry({ attrs, atMs, claimedToolCalls });
    case "tool_decision":
      return buildToolDecisionEntry({ attrs, atMs, seenScriptCalls });
    default:
      return buildTranscriptNoteEntry({ event, attrs, atMs });
  }
}

function userPromptEntry(attrs: Record<string, unknown>, atMs: number): TranscriptEntry {
  const raw = pickString(attrs, "prompt");
  const text = raw === null ? null : unwrapUserQuery(raw);
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
  if (isGrokEvent(pickString(attrs, "event.name"))) {
    return buildGrokToolResultEntry(attrs, atMs);
  }

  const name = pickString(attrs, "function_name");
  if (name === null) return null;

  const decision = pickString(attrs, "decision");
  if (decision === "reject") {
    // This shape names no decision source, so the line cannot pin the refusal on the user.
    return {
      kind: "tool_rejected",
      atMs,
      name,
      reason: decision,
      outcome: "denied",
      byUser: false,
    };
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

function isGrokEvent(eventName: string | null): boolean {
  return eventName !== null && (grokAgent.namePrefixes ?? []).some((p) => eventName.startsWith(p));
}

/** Grok has no tool spans: its tool_result event is the whole run, content included. */
function buildGrokToolResultEntry(
  attrs: Record<string, unknown>,
  atMs: number,
): TranscriptEntry | null {
  const name = pickString(attrs, "tool_name");
  if (name === null) return null;
  const origin = classifyToolCall({ toolName: name, server: pickString(attrs, "mcp_server_name") });

  return {
    kind: "tool",
    atMs,
    name,
    mcpServer: origin.kind === "mcp" ? origin.server : null,
    input: parseMaybeJson(pickString(attrs, "tool_input") ?? pickString(attrs, "tool_parameters")),
    output: pickString(attrs, "tool_output"),
    durationMs: pickNumber(attrs, "duration_ms"),
    failed: pickString(attrs, "success")?.toLowerCase() === "false",
    agentId: null,
    spanId: "",
  };
}

function buildToolDecisionEntry({
  attrs,
  atMs,
  seenScriptCalls,
}: {
  attrs: Record<string, unknown>;
  atMs: number;
  seenScriptCalls: Set<string>;
}): TranscriptEntry | null {
  const decision = pickString(attrs, "decision");
  const source = pickString(attrs, "source");
  const outcome = toolDecisionOutcome({ decision, source });
  if (outcome === "allowed") return buildScriptToolCallEntry({ attrs, atMs, seenScriptCalls });
  if (decision === null || outcome === "unknown") return null;

  return {
    kind: "tool_rejected",
    atMs,
    name: pickString(attrs, "tool_name"),
    reason: source ?? decision,
    outcome,
    byUser: toolDecisionByUser({ source }),
  };
}

/** Claude Code names a call made from inside a Code Mode REPL script `repl_<uuid>`. */
const SCRIPT_TOOL_USE_ID_PREFIX = "repl_";

/**
 * A call a Code Mode script made. Its accepted decision is the only record it leaves: no
 * span and no result log, so it carries the tool's parameters and no output or duration.
 */
function buildScriptToolCallEntry({
  attrs,
  atMs,
  seenScriptCalls,
}: {
  attrs: Record<string, unknown>;
  atMs: number;
  seenScriptCalls: Set<string>;
}): TranscriptEntry | null {
  const toolUseId = pickString(attrs, "tool_use_id");
  if (toolUseId === null || !toolUseId.startsWith(SCRIPT_TOOL_USE_ID_PREFIX)) return null;
  if (seenScriptCalls.has(toolUseId)) return null;

  const name = pickString(attrs, "tool_name");
  if (name === null) return null;
  seenScriptCalls.add(toolUseId);

  return {
    kind: "tool",
    atMs,
    name,
    mcpServer: parseMcpToolName(name)?.server ?? null,
    input: parseMaybeJson(pickString(attrs, "tool_parameters")),
    output: null,
    durationMs: null,
    failed: false,
    agentId: null,
    spanId: "",
    inScript: true,
  };
}

/** A Poll Claude Code adds itself, to hand over a finished script's result: `poll_<uuid>`. */
const DELIVERED_POLL_ID_PREFIX = "poll_";
const POLL_TOOL_NAME = "Poll";
const REQUEST_BODY_EVENT = "api_request_body";

type ToolEntry = Extract<TranscriptEntry, { kind: "tool" }>;
type Block = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  tool_use_id?: unknown;
  content?: unknown;
};
type Message = { role?: unknown; content?: unknown };

/**
 * The Poll calls Claude Code adds on its own: no tool span or result log is written for them,
 * so their result lives only in the next request body. One entry per call, at that request.
 */
export function collectDeliveredPolls(logs: TranscriptLogRecord[]): TranscriptEntry[] {
  const seen = new Set<string>();
  const entries: TranscriptEntry[] = [];
  for (const log of logs) {
    const event = pickString(log.attributes, "event.name");
    if (event === null || !event.endsWith(REQUEST_BODY_EVENT)) continue;

    for (const delivered of readDeliveredPolls(pickString(log.attributes, "body"))) {
      if (seen.has(delivered.id)) continue;
      seen.add(delivered.id);
      entries.push(pollEntry({ atMs: log.timestampMs, output: delivered.text }));
    }
  }
  return entries;
}

function readDeliveredPolls(body: string | null): { id: string; text: string }[] {
  const messages = parseMessages(body);
  const pollIds = new Set(
    messages.flatMap((message) =>
      message.role === "assistant"
        ? blocksOf(message).flatMap((block) => (isDeliveredPollUse(block) ? [block.id] : []))
        : [],
    ),
  );
  if (pollIds.size === 0) return [];

  return messages.flatMap((message) =>
    message.role === "user"
      ? blocksOf(message).flatMap((block) => {
          const id = block.tool_use_id;
          if (block.type !== "tool_result" || typeof id !== "string" || !pollIds.has(id)) return [];
          return [{ id, text: resultText(block.content) }];
        })
      : [],
  );
}

function isDeliveredPollUse(block: Block): block is Block & { id: string } {
  return (
    block.type === "tool_use" &&
    block.name === POLL_TOOL_NAME &&
    typeof block.id === "string" &&
    block.id.startsWith(DELIVERED_POLL_ID_PREFIX)
  );
}

function parseMessages(body: string | null): Message[] {
  if (body === null) return [];
  try {
    const parsed = JSON.parse(body) as { messages?: unknown };
    return Array.isArray(parsed.messages) ? (parsed.messages as Message[]) : [];
  } catch {
    return [];
  }
}

function blocksOf(message: Message): Block[] {
  return Array.isArray(message.content) ? (message.content as Block[]) : [];
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part: { type?: unknown; text?: unknown }) =>
      part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    )
    .join("\n");
}

function pollEntry({ atMs, output }: { atMs: number; output: string }): ToolEntry {
  return {
    kind: "tool",
    atMs,
    name: POLL_TOOL_NAME,
    mcpServer: null,
    input: {},
    output,
    durationMs: null,
    failed: false,
    agentId: null,
    spanId: "",
  };
}
