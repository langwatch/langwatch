/**
 * The "Talk to it" panel state machine, as a pure reducer.
 *
 * idle → connecting → live → saving → done, with error and needs-name
 * branches. Kept side-effect-free so every transition the ACs name — mic
 * denied, mint failure, cut at the limit, a fetch-failed post-call notice — is
 * unit-tested without a socket, a timer or React.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */

import type { VoiceTurn } from "./voice-transport-client.registry";

// -- Customer-facing copy (one place, asserted by tests) ---------------------

export const MIC_DENIED_MESSAGE =
  "Microphone access was denied. Allow it in the browser and try again.";
export const NO_KEY_MESSAGE = "No ElevenLabs key in this project";
export const CONSENT_NOTICE =
  "This call is recorded and sent to ElevenLabs. LangWatch gateway guardrails do not apply to this session.";
export const CUT_AT_LIMIT_MESSAGE = "Cut at the call limit";
export const FETCH_FAILED_NOTICE =
  "Recording could not be fetched from ElevenLabs";

/** Prefix for a provider mint failure the user can retry (AC9). */
export const MINT_FAILED_PREFIX = "Could not start the call";

/** Why an error state exists — steers which copy and link the panel shows. */
export type ErrorCode =
  | "mic_denied"
  | "key_missing"
  | "mint_failed"
  | "save_failed";

export type TalkState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | {
      kind: "live";
      conversationId?: string;
      transcript: VoiceTurn[];
      elapsedMs: number;
    }
  | { kind: "saving"; transcript: VoiceTurn[]; cutAtLimit: boolean }
  | {
      kind: "needsName";
      transcript: VoiceTurn[];
      cutAtLimit: boolean;
      conversationId?: string;
    }
  | {
      kind: "done";
      runId: string;
      agentId: string;
      transcript: VoiceTurn[];
      hasAudio: boolean;
      fetchFailed: boolean;
      cutAtLimit: boolean;
    }
  | { kind: "error"; code: ErrorCode; message: string };

export type TalkEvent =
  | { type: "START" }
  | { type: "MIC_DENIED" }
  | {
      type: "MINT_FAILED";
      code: "key_missing" | "mint_failed";
      message: string;
    }
  | { type: "CONNECTED"; conversationId: string }
  | { type: "TRANSCRIPT"; turn: VoiceTurn }
  | { type: "TICK"; elapsedMs: number }
  | { type: "HANG_UP" }
  | { type: "LIMIT_REACHED" }
  | {
      type: "SAVED";
      runId: string;
      agentId: string;
      hasAudio: boolean;
      fetchFailed: boolean;
    }
  | { type: "NAME_REQUIRED" }
  | { type: "SAVE_FAILED"; message: string }
  | { type: "RETRY" };

export const initialTalkState: TalkState = { kind: "idle" };

function transcriptOf(state: TalkState): VoiceTurn[] {
  return "transcript" in state ? state.transcript : [];
}

export function talkReducer(state: TalkState, event: TalkEvent): TalkState {
  switch (event.type) {
    case "START":
      return { kind: "connecting" };

    case "MIC_DENIED":
      // A denied mic never leaves the panel on "Connecting" and never starts a
      // run (AC27): it falls straight to a retryable error.
      return { kind: "error", code: "mic_denied", message: MIC_DENIED_MESSAGE };

    case "MINT_FAILED":
      return {
        kind: "error",
        code: event.code,
        message:
          event.code === "key_missing"
            ? NO_KEY_MESSAGE
            : `${MINT_FAILED_PREFIX}: ${event.message}`,
      };

    case "CONNECTED":
      if (state.kind !== "connecting" && state.kind !== "live") return state;
      return {
        kind: "live",
        conversationId: event.conversationId,
        transcript: transcriptOf(state),
        elapsedMs: state.kind === "live" ? state.elapsedMs : 0,
      };

    case "TRANSCRIPT":
      if (state.kind !== "live") return state;
      return { ...state, transcript: [...state.transcript, event.turn] };

    case "TICK":
      if (state.kind !== "live") return state;
      return { ...state, elapsedMs: event.elapsedMs };

    case "HANG_UP":
      if (state.kind !== "live") return state;
      return {
        kind: "saving",
        transcript: state.transcript,
        cutAtLimit: false,
      };

    case "LIMIT_REACHED":
      // The call ends by itself at the limit — the post-call view is reached
      // with no Hang up click (AC12) — and the run is marked cut (AC28-shaped).
      if (state.kind !== "live") return state;
      return { kind: "saving", transcript: state.transcript, cutAtLimit: true };

    case "NAME_REQUIRED":
      if (state.kind !== "saving") return state;
      return {
        kind: "needsName",
        transcript: state.transcript,
        cutAtLimit: state.cutAtLimit,
      };

    case "SAVED":
      return {
        kind: "done",
        runId: event.runId,
        agentId: event.agentId,
        hasAudio: event.hasAudio,
        fetchFailed: event.fetchFailed,
        transcript: transcriptOf(state),
        cutAtLimit: "cutAtLimit" in state ? state.cutAtLimit : false,
      };

    case "SAVE_FAILED":
      return { kind: "error", code: "save_failed", message: event.message };

    case "RETRY":
      return { kind: "idle" };

    default:
      return state;
  }
}
