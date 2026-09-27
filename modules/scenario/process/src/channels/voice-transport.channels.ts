import type { AgentAdapter } from "@langwatch/scenario";
import type { VoiceAgentData, VoiceTransport } from "@langwatch/scenario-contract";

import { elevenLabsConvaiTransport } from "./http/http.elevenlabs-voice-transport.channel.ts";
import {
  createPhoneTransport,
  type PhoneTransportEnvironment,
} from "./http/http.phone-voice-transport.channel.ts";
import type { VoiceTransportRunner } from "./voice-transport.channel.ts";

export function createVoiceTransportRegistry(
  environment: PhoneTransportEnvironment,
): Record<VoiceTransport, VoiceTransportRunner> {
  return {
    elevenlabs_convai: elevenLabsConvaiTransport,
    phone: createPhoneTransport({ environment }),
  };
}

/**
 * Shown on a voice run whose project has no OpenAI key: the SDK builds its
 * own client for TTS and judge transcription, so this is required regardless
 * of caller provider. Fails before connecting, not mid-call.
 */
export const NO_OPENAI_KEY_MESSAGE =
  "The caller voice needs an OpenAI key. Add one in Settings > Model Providers.";

export function createSerializedVoiceAgentAdapter({
  data,
  registry,
}: {
  data: VoiceAgentData;
  /** The voice transports by vendor, built with environment drilled in. */
  registry: Record<VoiceTransport, VoiceTransportRunner>;
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
