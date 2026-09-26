import { explainAnyError } from "@langwatch/error-presentation/presentation";
import { readHandledError } from "@langwatch/error-presentation/read-handled-error";
import { useMemo } from "react";

import { api } from "../../../behavior/scenario-api.ts";
import type { VoiceSessionClient, VoiceSessionFailure } from "../model/voice-call.ts";

/** A refusal read by its handled code, worded from the presentation registry. */
export function describeVoiceSessionFailure(error: unknown): VoiceSessionFailure {
  const explanation = explainAnyError(error);
  const code = readHandledError(error)?.code;
  return {
    ...(code ? { code } : {}),
    message: explanation.description || explanation.title,
  };
}

/** The voice-session doors over scenario's own tRPC procedures. */
export function useVoiceSessionClient(): VoiceSessionClient {
  const mint = api.scenarios.mintVoiceSession.useMutation();
  const finish = api.scenarios.finishVoiceSession.useMutation();
  const mintAsync = mint.mutateAsync;
  const finishAsync = finish.mutateAsync;
  return useMemo(
    () => ({
      mint: (input) => mintAsync(input),
      finish: (input) => finishAsync(input),
      describeFailure: describeVoiceSessionFailure,
    }),
    [mintAsync, finishAsync],
  );
}
