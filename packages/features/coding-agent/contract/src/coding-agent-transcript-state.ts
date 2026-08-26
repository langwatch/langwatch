import type { CodingAgentTranscript, TranscriptEntry } from "./coding-agent-transcript";
import { parseMaybeJson, readString } from "./coding-agent-transcript-value";

export interface TranscriptLogRecord {
  timestampMs: number;
  attributes: Record<string, unknown>;
  serviceName?: string | null;
}

export interface SpanReply {
  entry: TranscriptEntry;
  windowStartMs: number;
  windowEndMs: number;
}

export interface CodexToolLogContent {
  input: unknown;
  output: unknown;
  failed: boolean;
}

export type RenderedToolCall = Extract<TranscriptEntry, { kind: "tool" }>;
export type ClaimedToolCalls = Map<string, RenderedToolCall>;

export interface SpanEntryAccumulator {
  entries: TranscriptEntry[];
  spanReplies: SpanReply[];
  totals: CodingAgentTranscript["totals"];
  subAgentToolCounts: Map<string, number>;
  claimedToolCalls: ClaimedToolCalls;
  hasEmittedSystemPrompt: boolean;
  recoveredMessageCount: number;
  lastRecoveredReply: string | null;
}

export function createSpanEntryAccumulator(): SpanEntryAccumulator {
  return {
    entries: [],
    spanReplies: [],
    totals: { modelCalls: 0, toolCalls: 0, tokens: 0, costUsd: 0 },
    subAgentToolCounts: new Map(),
    claimedToolCalls: new Map(),
    hasEmittedSystemPrompt: false,
    recoveredMessageCount: 0,
    lastRecoveredReply: null,
  };
}

export function fillToolCallGaps(
  entry: RenderedToolCall,
  measured: { durationMs: number | null; failed: boolean },
): void {
  if (entry.durationMs === null) entry.durationMs = measured.durationMs;
  if (measured.failed) entry.failed = true;
}

export function indexCodexToolLogsByCallId(
  logs: TranscriptLogRecord[],
): Map<string, CodexToolLogContent> {
  const byCallId = new Map<string, CodexToolLogContent>();

  for (const log of logs) {
    if (readString(log.attributes, "event.name") !== "codex.tool_result") continue;

    const callId = readString(log.attributes, "call_id");
    if (callId === null || byCallId.has(callId)) continue;

    byCallId.set(callId, {
      input: parseMaybeJson(readString(log.attributes, "arguments")),
      output: readString(log.attributes, "output"),
      failed: readString(log.attributes, "success") === "false",
    });
  }

  return byCallId;
}
