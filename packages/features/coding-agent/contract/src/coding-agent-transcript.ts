import {
  detectCodingAgent,
  WITHHELD_PROMPT_TEXT,
} from "./telemetry/coding-agent-normalization";
import type { CodingAgent } from "./telemetry";
import type { SpanDetail } from "@langwatch/trace-contract";
import { collectLogEntries } from "./coding-agent-transcript-log";
import {
  type SpanReply,
  type TranscriptLogRecord,
  indexCodexToolLogsByCallId,
} from "./coding-agent-transcript-state";
import { collectSpanEntries } from "./coding-agent-transcript-span";
import { readUnknown } from "./coding-agent-transcript-value";

const LOG_REPLY_FLUSH_SLACK_MS = 2_000;
const PROMPT_STUB_SAME_TURN_MS = 2_000;

export type TranscriptEntry =
  | {
      kind: "system_prompt";
      atMs: number;
      text: string;
      chars: number;
    }
  | { kind: "user_prompt"; atMs: number; text: string | null; chars: number }
  | {
      kind: "assistant_message";
      atMs: number;
      text: string | null;
      model: string | null;
    }
  | {
      kind: "model_call";
      atMs: number;
      model: string | null;
      tokens: number;
      costUsd: number;
      durationMs: number | null;
      spanId: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
    }
  | {
      kind: "tool";
      atMs: number;
      name: string;
      mcpServer: string | null;
      input: unknown;
      output: unknown;
      durationMs: number | null;
      failed: boolean;
      agentId: string | null;
      spanId: string;
    }
  | {
      kind: "tool_rejected";
      atMs: number;
      name: string | null;
      reason: string | null;
    }
  | {
      kind: "note";
      atMs: number;
      level: "info" | "warning" | "error";
      event: string;
      text: string;
    };

export interface CodingAgentTranscript {
  agent: CodingAgent;
  sessionId: string | null;
  entries: TranscriptEntry[];
  totals: {
    modelCalls: number;
    toolCalls: number;
    tokens: number;
    costUsd: number;
  };
  subAgents: Array<{ agentId: string; toolCalls: number }>;
}

type UserPromptEntry = Extract<TranscriptEntry, { kind: "user_prompt" }>;

export type { TranscriptLogRecord } from "./coding-agent-transcript-state";

/** Build the transport-neutral transcript shared by the UI, CLI, and exports. */
export function buildCodingAgentTranscript({
  spans,
  logs,
}: {
  spans: SpanDetail[];
  logs: TranscriptLogRecord[];
}): CodingAgentTranscript {
  const codexToolLogs = indexCodexToolLogsByCallId(logs);
  const fromSpans = collectSpanEntries(spans, codexToolLogs);
  const fromLogs = collectLogEntries(logs, fromSpans.claimedToolCalls);
  const logEntries = withoutStubsOfRecoveredPrompts({
    spanEntries: fromSpans.entries,
    logEntries: fromLogs.entries,
  });
  const entries = [...fromSpans.entries, ...logEntries];

  addUnduplicatedSpanReplies(entries, fromSpans.spanReplies, fromLogs.entries);
  entries.sort((left, right) => left.atMs - right.atMs);
  moveSystemPromptFirst(entries);

  return {
    agent: detectAgentFrom({ spans, logs }),
    sessionId: fromLogs.sessionId,
    entries,
    totals: fromSpans.totals,
    subAgents: [...fromSpans.subAgentToolCounts.entries()]
      .map(([agentId, count]) => ({ agentId, toolCalls: count }))
      .sort((left, right) => right.toolCalls - left.toolCalls),
  };
}

function addUnduplicatedSpanReplies(
  entries: TranscriptEntry[],
  spanReplies: SpanReply[],
  logEntries: TranscriptEntry[],
): void {
  const logReplyTimes = logEntries
    .filter((entry) => entry.kind === "assistant_message")
    .map((entry) => entry.atMs);

  for (const reply of spanReplies) {
    const duplicatedByLog = logReplyTimes.some(
      (atMs) =>
        atMs >= reply.windowStartMs &&
        atMs <= reply.windowEndMs + LOG_REPLY_FLUSH_SLACK_MS,
    );
    if (!duplicatedByLog) entries.push(reply.entry);
  }
}

function moveSystemPromptFirst(entries: TranscriptEntry[]): void {
  const systemIndex = entries.findIndex((entry) => entry.kind === "system_prompt");
  if (systemIndex <= 0) return;

  const [systemEntry] = entries.splice(systemIndex, 1);
  if (systemEntry) entries.unshift(systemEntry);
}

function withoutStubsOfRecoveredPrompts({
  spanEntries,
  logEntries,
}: {
  spanEntries: TranscriptEntry[];
  logEntries: TranscriptEntry[];
}): TranscriptEntry[] {
  const stubs = logEntries.flatMap((entry, index) =>
    isWithheldPrompt(entry) ? [{ entry, index }] : [],
  );
  if (stubs.length === 0) return logEntries;

  const claimed = new Set<number>();
  const recovered = spanEntries.filter(isUserPromptEntry).sort((a, b) => a.atMs - b.atMs);

  for (const prompt of recovered) {
    const twin = nearestUnclaimedStub({ stubs, claimed, prompt });
    if (twin !== null) claimed.add(twin);
  }

  return logEntries.filter((_entry, index) => !claimed.has(index));
}

function isUserPromptEntry(entry: TranscriptEntry): entry is UserPromptEntry {
  return entry.kind === "user_prompt";
}

function isWithheldPrompt(entry: TranscriptEntry): entry is UserPromptEntry {
  return (
    isUserPromptEntry(entry) &&
    (entry.text === null || entry.text === WITHHELD_PROMPT_TEXT)
  );
}

function nearestUnclaimedStub({
  stubs,
  claimed,
  prompt,
}: {
  stubs: { entry: UserPromptEntry; index: number }[];
  claimed: Set<number>;
  prompt: UserPromptEntry;
}): number | null {
  let nearestIndex: number | null = null;
  let nearestDistanceMs = Number.POSITIVE_INFINITY;

  for (const { entry, index } of stubs) {
    if (claimed.has(index) || entry.chars !== prompt.chars) continue;

    const distanceMs = Math.abs(entry.atMs - prompt.atMs);
    if (distanceMs > PROMPT_STUB_SAME_TURN_MS || distanceMs >= nearestDistanceMs)
      continue;

    nearestDistanceMs = distanceMs;
    nearestIndex = index;
  }

  return nearestIndex;
}

function detectAgentFrom({
  spans,
  logs,
}: {
  spans: SpanDetail[];
  logs: TranscriptLogRecord[];
}): CodingAgent {
  for (const log of logs) {
    const agent = detectCodingAgent({
      recordName: attributeString(log.attributes, "event.name"),
      serviceName: log.serviceName,
    });
    if (agent !== "unknown") return agent;
  }

  for (const span of spans) {
    const agent = detectCodingAgent({ recordName: span.name });
    if (agent !== "unknown") return agent;
    if (hasOpencodeHeader(span.params)) return "opencode";
  }

  return "unknown";
}

function attributeString(attrs: Record<string, unknown>, key: string): string | null {
  const value = readUnknown(attrs, key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hasOpencodeHeader(attrs: Record<string, unknown> | null | undefined): boolean {
  const headers = readUnknown(attrs, "ai.request.headers");
  if (headers === null || typeof headers !== "object") return false;
  return Object.keys(headers as Record<string, unknown>).some((key) =>
    key.startsWith("x-opencode"),
  );
}
