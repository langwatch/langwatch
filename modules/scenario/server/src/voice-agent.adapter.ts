/**
 * Serialized voice adapter factory: must receive SDK's own adapter instance (not wrapper).
 * Credential handling mirrors http adapter: key from pre-fetched data, never in events/logs.
 */

import type { AgentAdapter } from "@langwatch/scenario";
import { voiceTransportRegistry } from "../../contract/src/voice/voice-transport.registry.ts";
import type { VoiceAgentData } from "../../contract/src/evaluations/types.ts";

/**
 * Shown on a voice run whose project has no OpenAI key: the SDK builds its
 * own client for TTS and judge transcription, so this is required regardless
 * of caller provider. Fails before connecting, not mid-call.
 */
export const NO_OPENAI_KEY_MESSAGE =
  "The caller voice needs an OpenAI key. Add one in Settings > Model Providers.";

export function createSerializedVoiceAgentAdapter({
  data,
  registry = voiceTransportRegistry,
}: {
  data: VoiceAgentData;
  /** Injected in tests so the failure messages can be asserted without a
   *  live socket. */
  registry?: typeof voiceTransportRegistry;
}): AgentAdapter {
  const runner = registry[data.voiceTarget.transport];
  if (!data.voiceTarget.credential) {
    throw new Error(runner.missingKeyMessage);
  }
  if (!data.callerEnv.OPENAI_API_KEY) {
    throw new Error(NO_OPENAI_KEY_MESSAGE);
  }
  return runner.createAgentAdapter({
    agentId: data.voiceTarget.agentId,
    credential: data.voiceTarget.credential,
    maxCallSeconds: data.maxCallSeconds,
  });
}
