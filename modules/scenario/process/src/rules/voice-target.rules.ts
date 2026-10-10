import {
  voiceAgentExternalId,
  type VoiceAgentConfig,
  type VoiceTarget,
} from "@langwatch/scenario-contract";

export interface VoiceTransportCredentialReader {
  findElevenLabs(projectId: string): Promise<{ apiKey: string; baseUrl: string } | null>;
  findTwilio(projectId: string): Promise<{
    accountSid: string;
    authToken: string;
    fromNumber: string;
  } | null>;
}

export async function resolveVoiceTarget({
  projectId,
  config,
  credentials,
}: {
  projectId: string;
  config: VoiceAgentConfig;
  credentials: VoiceTransportCredentialReader;
}): Promise<VoiceTarget> {
  if (config.transport === "elevenlabs_convai") {
    const credential = await credentials.findElevenLabs(projectId);
    return {
      transport: config.transport,
      agentId: voiceAgentExternalId(config),
      credential: credential ? { kind: "elevenlabs", ...credential } : null,
    };
  }

  const credential = await credentials.findTwilio(projectId);
  return {
    transport: config.transport,
    agentId: voiceAgentExternalId(config),
    credential: credential ? { kind: "twilio", ...credential } : null,
    callDirection: config.callDirection,
  };
}
