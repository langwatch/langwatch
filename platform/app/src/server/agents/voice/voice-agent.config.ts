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
export const VOICE_TRANSPORTS = ["elevenlabs_convai", "phone"] as const;
export type VoiceTransport = (typeof VOICE_TRANSPORTS)[number];

export const elevenLabsConvaiTransportSchema = z.object({
  transport: z.literal("elevenlabs_convai"),
  agentId: z.string().trim().min(1, "Agent id is required").max(128),
});

/**
 * E.164: a leading `+`, a non-zero country code digit, then up to 14 more
 * digits. The number is the whole identity of a phone target, so it is
 * validated at the schema boundary rather than trusted from the form.
 */
export const E164_PHONE_PATTERN = /^\+[1-9]\d{1,14}$/;

export const phoneTransportSchema = z.object({
  transport: z.literal("phone"),
  phoneNumber: z
    .string()
    .trim()
    .regex(
      E164_PHONE_PATTERN,
      "Enter the number in E.164 form, like +14155550123",
    ),
});

export const voiceAgentConfigSchema = z.discriminatedUnion("transport", [
  elevenLabsConvaiTransportSchema,
  phoneTransportSchema,
]);
export type VoiceAgentConfig = z.infer<typeof voiceAgentConfigSchema>;

/** The words a customer reads for each transport in the drawer. */
export const VOICE_TRANSPORT_LABELS: Record<VoiceTransport, string> = {
  elevenlabs_convai: "ElevenLabs agent",
  phone: "Phone number",
};

/** Model provider whose key signs sessions for this transport. */
export const VOICE_TRANSPORT_PROVIDER: Record<
  VoiceTransport,
  "elevenlabs" | "twilio"
> = {
  elevenlabs_convai: "elevenlabs",
  phone: "twilio",
};

export const parseVoiceAgentConfig = (config: unknown): VoiceAgentConfig =>
  voiceAgentConfigSchema.parse(config);

/**
 * The transport's own external identifier for a voice agent: the ElevenLabs
 * agent id, or the phone number for a phone target. This is the value that
 * forms the identity key ({@link voiceAgentIdentityKey}), so a phone target
 * keys on its number (voice:phone:+14155550123). Narrows on the transport with
 * an exhaustive switch, so a new transport member is a compile error here until
 * it says which field carries its identity.
 */
export const voiceAgentExternalId = (config: VoiceAgentConfig): string => {
  switch (config.transport) {
    case "elevenlabs_convai":
      return config.agentId;
    case "phone":
      return config.phoneNumber;
  }
};

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
