/**
 * The serialized voice adapter for the pool child.
 *
 * A factory rather than a `Serialized*Adapter` class: the executor's voice
 * lifecycle (`pickVoiceAdapters` / `startVoiceAdapters`) selects participants by
 * their `VoiceAgentAdapter` identity, so the run must receive the SDK's own
 * adapter instance, not a wrapper around it. This reads the pre-fetched voice
 * target and hands the transport registry the credential and the call budget.
 *
 * Credential handling mirrors the http adapter's secret handling: the key
 * arrives on the pre-fetched data, is passed to the transport, and never enters
 * an event or a log. A `null` credential (project has no key) fails the run
 * with the transport's named message — surfaced the same way any adapter
 * failure becomes the run's error, through the child's `main().catch`.
 */

import type { AgentAdapter } from "@langwatch/scenario";
import { voiceTransportRegistry } from "../../contract/src/voice/voice-transport.registry.ts";
import type { VoiceAgentData } from "../../contract/src/evaluations/types.ts";

/**
 * Shown on a voice run whose project has no OpenAI key. The SDK builds its own
 * OpenAI client for the caller's text-to-speech AND for the transcription the
 * judge reads, so this key is required for every voice run regardless of caller
 * provider. Failing here — before the transport connects — keeps the run from
 * hitting the SDK's cryptic "Missing credentials" error mid-call.
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
