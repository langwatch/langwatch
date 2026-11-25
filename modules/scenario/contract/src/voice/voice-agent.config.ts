// Voice agent type and transports. Transport is discriminated union inside config.
// Contract-legal: schemas and pure functions only, no persistence/credential/transport.

import type { VoiceTransport } from "./voice-transport.ts";
export {
  E164_PHONE_PATTERN,
  elevenLabsConvaiTransportSchema,
  parseVoiceAgentConfig,
  phoneTransportSchema,
  voiceAgentConfigSchema,
  type VoiceAgentConfig,
} from "@langwatch/agent-contract";
import {
  voiceAgentExternalId as agentVoiceExternalId,
  voiceAgentIdentityKey as agentVoiceIdentityKey,
  type VoiceAgentConfig,
} from "@langwatch/agent-contract";

/** The transport's label in the "Reached via" select. */
export const VOICE_TRANSPORT_LABELS: Record<VoiceTransport, string> = {
  elevenlabs_convai: "ElevenLabs agent",
  phone: "Phone number",
};

/** Model provider whose key signs sessions for this transport. */
export const VOICE_TRANSPORT_PROVIDER: Record<VoiceTransport, "elevenlabs" | "twilio"> = {
  elevenlabs_convai: "elevenlabs",
  phone: "twilio",
};

/**
 * The transport's own external identifier for a voice agent: the ElevenLabs
 * agent id, or the phone number for a phone target, the value forming the
 * identity key. An exhaustive switch makes a new transport a compile error here.
 */
export const voiceAgentExternalId = (config: VoiceAgentConfig): string =>
  agentVoiceExternalId(config);

/**
 * The natural key that folds every "Talk to it" against the same vendor
 * agent onto one row, so a retry or two racing tabs cannot create a second
 * row. Shares the `(projectId, identityKey)` constraint connected agents use.
 */
export const voiceAgentIdentityKey = (input: {
  transport: VoiceTransport;
  agentExternalId: string;
}): string => agentVoiceIdentityKey(input);
