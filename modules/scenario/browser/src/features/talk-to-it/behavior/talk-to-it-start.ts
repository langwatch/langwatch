import { nowInstant } from "@langwatch/time";

import {
  PHONE_NO_BROWSER_CALL_NOTICE,
  type TalkToItPanelProps,
} from "../model/talk-to-it-props.ts";
import type { VoiceCallSession } from "../model/voice-call.ts";
import { stopTick, type TalkDispatch, type TalkRefs } from "./talk-to-it-refs.ts";
import { mintSession } from "./talk-to-it-session.ts";
import { getVoiceTransportClient } from "./voice-transport-client.registry.ts";

/** Chromium's effective Permissions-Policy: a blocked mic rejects without ever prompting. */
function isMicBlockedByPolicy(): boolean {
  if (!("featurePolicy" in document)) return false;
  const policy: unknown = document.featurePolicy;
  if (typeof policy !== "object" || policy === null || !("allowsFeature" in policy)) return false;
  const { allowsFeature } = policy;
  return typeof allowsFeature === "function" && allowsFeature.call(policy, "microphone") === false;
}

/** Ask for the mic first so a denial is a clean, retryable state (AC27). */
async function requestMic(dispatch: TalkDispatch): Promise<boolean> {
  if (isMicBlockedByPolicy()) {
    dispatch({ type: "MIC_BLOCKED" });
    return false;
  }
  try {
    const media = await navigator.mediaDevices?.getUserMedia({ audio: true });
    media?.getTracks().forEach((track) => {
      track.stop();
    });
    return true;
  } catch {
    dispatch({ type: "MIC_DENIED" });
    return false;
  }
}

export async function runEndCall({
  refs,
  dispatch,
  finish,
  isCutAtLimit,
}: {
  refs: TalkRefs;
  dispatch: TalkDispatch;
  finish: (args: { nameOverride?: string }) => Promise<void>;
  // Drives this panel's LIMIT_REACHED vs HANG_UP display only; the server
  // derives the run's cut-at-limit marker from the call span (#8028).
  isCutAtLimit: boolean;
}): Promise<void> {
  // Single-flight: hangUp fires onDisconnect, which re-enters here. The first
  // end instant is the one the server's cutoff (endedAt - startedAt) must see,
  // so a re-entry after slow cleanup neither moves it nor finishes twice (#8028).
  if (refs.endedAt.current !== 0) return;
  stopTick(refs);
  refs.endedAt.current = nowInstant().epochMilliseconds;
  dispatch(isCutAtLimit ? { type: "LIMIT_REACHED" } : { type: "HANG_UP" });
  try {
    await refs.session.current?.hangUp();
  } catch {
    // The socket may already be closed; the finish still runs.
  }
  await finish({});
}

function startTick({
  refs,
  dispatch,
  setMicLevel,
  endCall,
}: {
  refs: TalkRefs;
  dispatch: TalkDispatch;
  setMicLevel: (level: number) => void;
  endCall: (isCutAtLimit: boolean) => void;
}): void {
  refs.tick.current = setInterval(() => {
    const elapsedMs = nowInstant().epochMilliseconds - refs.startedAt.current;
    dispatch({ type: "TICK", elapsedMs });
    setMicLevel(refs.session.current?.getInputVolume?.() ?? 0);
    if (elapsedMs >= refs.maxSeconds.current * 1000) endCall(true);
  }, 1000);
}

const failed = (message: string) =>
  ({ type: "MINT_FAILED", code: "mint_failed", message }) as const;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Mic, then mint, then open the call; `isStale` is true once a newer attempt or unmount wins. */
export async function runStart({
  props,
  refs,
  dispatch,
  setMicLevel,
  endCall,
  isStale,
}: {
  props: TalkToItPanelProps;
  refs: TalkRefs;
  dispatch: TalkDispatch;
  setMicLevel: (level: number) => void;
  endCall: (isCutAtLimit: boolean) => void;
  isStale: () => boolean;
}): Promise<void> {
  dispatch({ type: "START" });
  if (!(await requestMic(dispatch)) || isStale()) return;
  const mint = await mintSession({ props, refs, dispatch });
  if (!mint || isStale()) return;

  refs.maxSeconds.current = mint.maxDurationSeconds;
  refs.sessionToken.current = mint.sessionToken;
  refs.startedAt.current = nowInstant().epochMilliseconds;
  refs.endedAt.current = 0;

  const client = getVoiceTransportClient(props.transport);
  if (!client) return dispatch(failed(PHONE_NO_BROWSER_CALL_NOTICE));

  let session: VoiceCallSession;
  try {
    session = await client.openCall({
      signedUrl: mint.connect.signedUrl,
      handlers: {
        onConnected: ({ conversationId }) => {
          refs.conversationId.current = conversationId;
          dispatch({ type: "CONNECTED", conversationId });
        },
        onTranscript: (turn) => dispatch({ type: "TRANSCRIPT", turn }),
        onDisconnect: () => endCall(false),
        onError: (error) => dispatch(failed(error.message)),
      },
    });
  } catch (error) {
    return dispatch(failed(messageOf(error)));
  }

  if (isStale()) {
    // Unmounted while the call was opening: hang up the session that just arrived.
    void session.hangUp().catch(() => {});
    return;
  }
  refs.session.current = session;
  startTick({ refs, dispatch, setMicLevel, endCall });
}
