/**
 * The "Talk to it" panel's states and events: idle → connecting → live → saving → done, with
 * error and needs-name branches. The reducer lives in talk-to-it-transitions.ts.
 * @see specs/features/agents/voice-agents-v1.feature
 */
import type { VoiceTurn } from "./voice-call.ts";

export const MIC_DENIED_MESSAGE =
  "Microphone access was denied. Allow it in the browser and try again.";
/** The page may not use the microphone at all, so the browser never prompts. */
export const MIC_BLOCKED_MESSAGE =
  "This page is not allowed to use the microphone. Check the Permissions-Policy header on the LangWatch host or reverse proxy, then reload.";
export const NO_KEY_MESSAGE = "No ElevenLabs key in this project";
export const CONSENT_NOTICE =
  "This call is recorded and sent to ElevenLabs. LangWatch gateway guardrails do not apply to this session.";
export const CUT_AT_LIMIT_MESSAGE = "Cut at the call limit";
export const FETCH_FAILED_NOTICE = "Recording could not be fetched from ElevenLabs";

/** Prefix for a provider mint failure the user can retry (AC9). */
export const MINT_FAILED_PREFIX = "Could not start the call";

/** Why an error state exists — steers which copy and link the panel shows. */
export type ErrorCode =
  | "mic_denied"
  | "mic_blocked"
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
  | { kind: "saving"; transcript: VoiceTurn[]; isCutAtLimit: boolean }
  | {
      kind: "needsName";
      transcript: VoiceTurn[];
      isCutAtLimit: boolean;
      conversationId?: string;
    }
  | {
      kind: "done";
      runId: string;
      agentId: string;
      transcript: VoiceTurn[];
      hasAudio: boolean;
      /** Same-origin proxy URL to play the recording, when there is one. */
      audioUrl?: string;
      hasFetchFailed: boolean;
      isCutAtLimit: boolean;
    }
  | { kind: "error"; code: ErrorCode; message: string };

export type TalkEvent =
  | { type: "START" }
  | { type: "MIC_DENIED" }
  | { type: "MIC_BLOCKED" }
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
      audioUrl?: string;
      hasFetchFailed: boolean;
    }
  | { type: "NAME_REQUIRED" }
  | { type: "SAVE_FAILED"; message: string }
  | { type: "RETRY" };

export const initialTalkState: TalkState = { kind: "idle" };

export function formatMmSs(totalSeconds: number): string {
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}
