import { VOICE_CALL_MAX_SECONDS_DEFAULT } from "@langwatch/scenario-contract";

import { initialTalkState, type TalkEvent, type TalkState } from "../model/talk-to-it-machine.ts";
import type { VoiceCallSession } from "../model/voice-call.ts";

export type TalkDispatch = (event: TalkEvent) => void;

/** Mutable slots the call machinery reads and writes across a session. */
export type TalkRefs = {
  session: { current: VoiceCallSession | null };
  startedAt: { current: number };
  conversationId: { current: string | undefined };
  /** The signed session token from mint, carried back verbatim to finish. */
  sessionToken: { current: string | undefined };
  maxSeconds: { current: number };
  /** The set the finished run landed in, so a scenario call links to the scenario's set. */
  runSetId: { current: string | undefined };
  tick: { current: ReturnType<typeof setInterval> | null };
  createdRowId: { current: string | undefined };
  /** The latest reducer state, mirrored during render, for handlers wired once on mount (#21). */
  stateRef: { current: TalkState };
};

export function createTalkRefs(agentRowId: string | undefined): TalkRefs {
  return {
    session: { current: null },
    startedAt: { current: 0 },
    conversationId: { current: undefined },
    sessionToken: { current: undefined },
    maxSeconds: { current: VOICE_CALL_MAX_SECONDS_DEFAULT },
    runSetId: { current: undefined },
    tick: { current: null },
    createdRowId: { current: agentRowId },
    stateRef: { current: initialTalkState },
  };
}

/** Only a "Call it myself" call writes a run (#8020); a drawer call links nowhere. */
export function runHrefOf({
  state,
  runSetId,
  projectSlug,
}: {
  state: TalkState;
  runSetId: string | undefined;
  projectSlug: string;
}): string | undefined {
  if (state.kind !== "done" || !state.runId || !runSetId) return undefined;
  return `/${projectSlug}/simulations/${runSetId}/${encodeURIComponent(state.runId)}`;
}

export function stopTick(refs: TalkRefs): void {
  if (refs.tick.current) {
    clearInterval(refs.tick.current);
    refs.tick.current = null;
  }
}

/** Unmounting mid-call must not leave the provider connected with the mic open (#18). */
export function leaveCall({
  refs,
  endCall,
}: {
  refs: TalkRefs;
  endCall: (isCutAtLimit: boolean) => void;
}): void {
  stopTick(refs);
  if (refs.stateRef.current.kind === "live") endCall(false);
}
