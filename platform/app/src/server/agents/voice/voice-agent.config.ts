/**
 * The one voice agent type, and the transports it can be reached through.
 *
 * The transport is a discriminated union inside the agent's `config`, so a
 * later transport (phone) is a new member here rather than a new agent type or
 * a new component. No vendor name leaks past this module: everything else
 * speaks of a "voice" agent and a `VoiceTransport`, and only the transport
 * members name ElevenLabs.
 *
 * Importable from client code (like agent.repository), so the drawer and the
 * server validate against the same schema.
 */

import { z } from "zod";

/** Every transport a voice agent can be reached through. */
export const VOICE_TRANSPORTS = ["elevenlabs_convai"] as const;
export type VoiceTransport = (typeof VOICE_TRANSPORTS)[number];

export const elevenLabsConvaiTransportSchema = z.object({
  transport: z.literal("elevenlabs_convai"),
  agentId: z.string().trim().min(1, "Agent id is required").max(128),
});

export const voiceAgentConfigSchema = z.discriminatedUnion("transport", [
  elevenLabsConvaiTransportSchema,
]);
export type VoiceAgentConfig = z.infer<typeof voiceAgentConfigSchema>;

/** The words a customer reads for each transport in the drawer. */
export const VOICE_TRANSPORT_LABELS: Record<VoiceTransport, string> = {
  elevenlabs_convai: "ElevenLabs agent",
};

/** Model provider whose key signs sessions for this transport. */
export const VOICE_TRANSPORT_PROVIDER: Record<VoiceTransport, "elevenlabs"> = {
  elevenlabs_convai: "elevenlabs",
};

export const parseVoiceAgentConfig = (config: unknown): VoiceAgentConfig =>
  voiceAgentConfigSchema.parse(config);

/** The scenario set every drawer "Talk to it" call is written into, so those
 *  runs group apart from scenario runs. Client-safe (the panel builds the run
 *  link from it; the run writer writes into it). */
export const VOICE_CALL_SCENARIO_SET_ID = "voice-calls";
