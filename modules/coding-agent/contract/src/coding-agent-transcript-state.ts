import type { SpanDetail } from "@langwatch/trace-contract";

import { extractSystemText } from "./coding-agent-transcript-content.ts";
import { parseMaybeJson, pickString } from "./coding-agent-transcript-value.ts";
import type { CodingAgentTranscript, TranscriptEntry } from "./coding-agent-transcript.ts";

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
    if (pickString(log.attributes, "event.name") !== "codex.tool_result") continue;

    const callId = pickString(log.attributes, "call_id");
    if (callId === null || byCallId.has(callId)) continue;

    byCallId.set(callId, {
      input: parseMaybeJson(pickString(log.attributes, "arguments")),
      output: pickString(log.attributes, "output"),
      failed: pickString(log.attributes, "success") === "false",
    });
  }

  return byCallId;
}

// Record system prompt once per transcript; flag prevents duplication across
// spans visiting the accumulator.
export function emitSystemPrompt(span: SpanDetail, accumulator: SpanEntryAccumulator): void {
  if (accumulator.hasEmittedSystemPrompt) return;

  const systemText = extractSystemText(span.input);
  if (systemText === null) return;

  accumulator.hasEmittedSystemPrompt = true;
  accumulator.entries.push({
    kind: "system_prompt",
    atMs: span.startTimeMs,
    text: systemText,
    chars: systemText.length,
  });
}
