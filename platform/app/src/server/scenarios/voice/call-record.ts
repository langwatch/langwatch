/**
 * The one shape a finished voice call is normalised into, whatever transport
 * ran it. The transport turns its vendor payload into this; everything above —
 * the run writer, the panel's post-call view — reads only this, so a later
 * transport (phone) adds a normaliser rather than a new run shape.
 *
 * Server-only: it derives the idempotency run id with `node:crypto`.
 */

import { createHash } from "node:crypto";
import type { VoiceTransport } from "~/server/agents/voice/voice-agent.config";

export type CallTurnRole = "caller" | "agent";

export interface CallTurn {
  role: CallTurnRole;
  text: string;
  /** Offset from the call start, when the transport reports it. */
  startMs?: number;
  endMs?: number;
  /** Per-turn audio, when the transport exposes it. */
  audioUrl?: string;
}

/** Where the turns came from: the provider's record, or the live browser. */
export type CallRecordSource = "provider" | "browser";

export interface CallRecord {
  conversationId: string;
  transport: VoiceTransport;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  turns: CallTurn[];
  /** Whole-call recording, when the provider returned one. */
  audioUrl?: string;
  cutAtLimit: boolean;
  source: CallRecordSource;
}

/** One turn as the browser captured it live during the call. */
export interface BrowserTranscriptTurn {
  role: CallTurnRole;
  text: string;
}

/**
 * Build a record from the transcript the browser captured live. Used when the
 * provider's record is not ready yet, or the post-call fetch failed: the run
 * still holds what was said. Marked `source: "browser"` and never carries audio.
 */
export function browserTranscriptToCallRecord({
  conversationId,
  transport,
  transcript,
  startedAt,
  endedAt,
  cutAtLimit,
}: {
  conversationId: string;
  transport: VoiceTransport;
  transcript: BrowserTranscriptTurn[];
  startedAt: number;
  endedAt: number;
  cutAtLimit: boolean;
}): CallRecord {
  return {
    conversationId,
    transport,
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    turns: transcript.map((turn) => ({ role: turn.role, text: turn.text })),
    cutAtLimit,
    source: "browser",
  };
}

/** The run id prefix that marks a run written from a voice call. */
export const VOICE_RUN_ID_PREFIX = "voicecall_";

/**
 * The run id a conversation writes to, derived from the conversation id alone.
 *
 * Ingestion is idempotent on this: hanging up twice, a mid-call reload, or a
 * late webhook all resolve to the same id, so the writer can check whether the
 * run already exists before writing it again (AC14). Two attempts for the same
 * conversation always produce the same id; two conversations never collide.
 */
export function scenarioRunIdForConversation(conversationId: string): string {
  const digest = createHash("sha256")
    .update(conversationId)
    .digest("hex")
    .slice(0, 32);
  return `${VOICE_RUN_ID_PREFIX}${digest}`;
}
