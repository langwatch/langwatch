import {
  MIC_BLOCKED_MESSAGE,
  MIC_DENIED_MESSAGE,
  MINT_FAILED_PREFIX,
  NO_KEY_MESSAGE,
  type TalkEvent,
  type TalkState,
} from "./talk-to-it-machine.ts";
import type { VoiceTurn } from "./voice-call.ts";

type EventOf<Type extends TalkEvent["type"]> = Extract<TalkEvent, { type: Type }>;

function transcriptOf(state: TalkState): VoiceTurn[] {
  return "transcript" in state ? state.transcript : [];
}

function mintFailed(event: EventOf<"MINT_FAILED">): TalkState {
  return {
    kind: "error",
    code: event.code,
    message:
      event.code === "key_missing" ? NO_KEY_MESSAGE : `${MINT_FAILED_PREFIX}: ${event.message}`,
  };
}

function connected(state: TalkState, event: EventOf<"CONNECTED">): TalkState {
  if (state.kind !== "connecting" && state.kind !== "live") return state;
  return {
    kind: "live",
    conversationId: event.conversationId,
    transcript: transcriptOf(state),
    elapsedMs: state.kind === "live" ? state.elapsedMs : 0,
  };
}

/** The call ends by itself at the limit (AC12) and the run is marked cut. */
function callEnded(state: TalkState, isCutAtLimit: boolean): TalkState {
  return state.kind === "live"
    ? { kind: "saving", transcript: state.transcript, isCutAtLimit }
    : state;
}

function nameRequired(state: TalkState): TalkState {
  return state.kind === "saving"
    ? { kind: "needsName", transcript: state.transcript, isCutAtLimit: state.isCutAtLimit }
    : state;
}

function saved(state: TalkState, event: EventOf<"SAVED">): TalkState {
  return {
    kind: "done",
    runId: event.runId,
    agentId: event.agentId,
    hasAudio: event.hasAudio,
    audioUrl: event.audioUrl,
    hasFetchFailed: event.hasFetchFailed,
    transcript: transcriptOf(state),
    isCutAtLimit: "isCutAtLimit" in state ? state.isCutAtLimit : false,
  };
}

/** One transition per event; a transition that does not apply returns the state unchanged. */
export function talkReducer(state: TalkState, event: TalkEvent): TalkState {
  switch (event.type) {
    case "START":
      return { kind: "connecting" };
    case "MIC_DENIED":
      return { kind: "error", code: "mic_denied", message: MIC_DENIED_MESSAGE };
    case "MIC_BLOCKED":
      return { kind: "error", code: "mic_blocked", message: MIC_BLOCKED_MESSAGE };
    case "MINT_FAILED":
      return mintFailed(event);
    case "CONNECTED":
      return connected(state, event);
    case "TRANSCRIPT":
      return state.kind === "live"
        ? { ...state, transcript: [...state.transcript, event.turn] }
        : state;
    case "TICK":
      return state.kind === "live" ? { ...state, elapsedMs: event.elapsedMs } : state;
    case "HANG_UP":
      return callEnded(state, false);
    case "LIMIT_REACHED":
      return callEnded(state, true);
    case "NAME_REQUIRED":
      return nameRequired(state);
    case "SAVED":
      return saved(state, event);
    case "SAVE_FAILED":
      return { kind: "error", code: "save_failed", message: event.message };
    case "RETRY":
      return { kind: "idle" };
  }
}
