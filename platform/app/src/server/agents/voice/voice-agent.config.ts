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

/**
 * The legacy scenario set drawer "Talk to it" calls used to be written into,
 * before #8020 stopped persisting a drawer call as a run. Nothing is written
 * here any more (a drawer call now leaves only its per-exchange traces), but
 * pre-#8020 `voicecall_` runs still carry this set id in ClickHouse, so run
 * listings exclude it (see `AGENT_TEST_SET_EXCLUSION`). A run someone has a
 * direct link to still opens by its own id.
 */
export const VOICE_CALL_SCENARIO_SET_ID = "voice-calls";

/**
 * The natural key that folds every "Talk to it" against the same vendor agent
 * onto one row, so a first hang-up before the agent is saved cannot create a
 * second agent row on a retry (or from two browser tabs racing). Shares the
 * `(projectId, identityKey)` unique constraint the connected agents use.
 */
export const voiceAgentIdentityKey = ({
  transport,
  agentExternalId,
}: {
  transport: VoiceTransport;
  agentExternalId: string;
}): string => `voice:${transport}:${agentExternalId}`;
