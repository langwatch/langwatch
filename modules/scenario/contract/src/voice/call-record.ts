/**
 * The one shape a finished voice call is normalised into, whatever transport
 * ran it; a later transport (phone) adds a normaliser rather than a new run
 * shape.
 */

import type { VoiceTransport } from "./voice-transport.ts";

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
  /** The vendor agent id the finished conversation actually ran against, when
   *  the provider record exposes it. Finish rejects a record whose id differs
   *  from the session token's, so one project cannot ingest another's call. A
   *  browser-fallback record carries none. */
  agentExternalId?: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  turns: CallTurn[];
  /** Whole-call recording, when the provider returned one. */
  audioUrl?: string;
  isCutAtLimit: boolean;
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
  isCutAtLimit,
}: {
  conversationId: string;
  transport: VoiceTransport;
  transcript: BrowserTranscriptTurn[];
  startedAt: number;
  endedAt: number;
  isCutAtLimit: boolean;
}): CallRecord {
  return {
    conversationId,
    transport,
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    turns: transcript.map((turn) => ({ role: turn.role, text: turn.text })),
    isCutAtLimit,
    source: "browser",
  };
}

/** The run id prefix that marks a run written from a voice call. */
export const VOICE_RUN_ID_PREFIX = "voicecall_";
