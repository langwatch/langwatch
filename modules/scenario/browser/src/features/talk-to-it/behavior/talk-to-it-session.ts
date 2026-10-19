import type {
  VoiceSessionFinishResult,
  VoiceSessionMintResult,
} from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";

import type { TalkToItPanelProps } from "../model/talk-to-it-props.ts";
import type { TalkDispatch, TalkRefs } from "./talk-to-it-refs.ts";

function adoptFinishResult({
  props,
  refs,
  dispatch,
  result,
}: {
  props: TalkToItPanelProps;
  refs: TalkRefs;
  dispatch: TalkDispatch;
  result: VoiceSessionFinishResult;
}): void {
  if (result.agentId) {
    refs.createdRowId.current = result.agentId;
    if (!props.agentRowId) props.onAgentCreated?.(result.agentId);
  }
  if (result.scenarioSetId) refs.runSetId.current = result.scenarioSetId;
  dispatch({
    type: "SAVED",
    runId: result.runId,
    agentId: result.agentId,
    hasAudio: result.hasAudio,
    audioUrl: result.audioUrl,
    hasFetchFailed: result.hasFetchFailed,
  });
}

/** Hand the finished call to the finish door; a missing name asks for one instead. */
export async function runFinish({
  props,
  refs,
  dispatch,
  isCutAtLimit,
  nameOverride,
}: {
  props: TalkToItPanelProps;
  refs: TalkRefs;
  dispatch: TalkDispatch;
  isCutAtLimit: boolean;
  nameOverride?: string;
}): Promise<void> {
  // Read off the ref: a provider disconnect arrives through handlers wired at start (#21).
  const state = refs.stateRef.current;
  let result: VoiceSessionFinishResult;
  try {
    result = await props.sessionClient.finish({
      projectId: props.projectId,
      sessionToken: refs.sessionToken.current ?? "",
      name: nameOverride ?? props.name,
      conversationId: refs.conversationId.current,
      transcript: "transcript" in state ? state.transcript : [],
      startedAt: refs.startedAt.current || nowInstant().epochMilliseconds,
      endedAt: nowInstant().epochMilliseconds,
      isCutAtLimit,
      ...(props.scenarioId ? { scenarioId: props.scenarioId } : {}),
    });
  } catch (error) {
    const failure = props.sessionClient.describeFailure(error);
    dispatch(
      failure.code === "voice_name_required"
        ? { type: "NAME_REQUIRED" }
        : { type: "SAVE_FAILED", message: failure.message },
    );
    return;
  }
  adoptFinishResult({ props, refs, dispatch, result });
}

/** Mint a signed-URL session; a failure lands on the retryable error, never a spinner. */
export async function mintSession({
  props,
  refs,
  dispatch,
}: {
  props: TalkToItPanelProps;
  refs: TalkRefs;
  dispatch: TalkDispatch;
}): Promise<VoiceSessionMintResult | null> {
  try {
    return await props.sessionClient.mint({
      projectId: props.projectId,
      transport: props.transport,
      // Trusted only while no row is saved; a saved row's own vendor id wins (AC13/AC29).
      agentId: props.agentId,
      ...(refs.createdRowId.current ? { agentRowId: refs.createdRowId.current } : {}),
    });
  } catch (error) {
    const failure = props.sessionClient.describeFailure(error);
    dispatch({
      type: "MINT_FAILED",
      code: failure.code === "voice_key_missing" ? "key_missing" : "mint_failed",
      message: failure.message,
    });
    return null;
  }
}
