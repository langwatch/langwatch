/**
 * The one voice agent type, and the transports it can be reached through.
 *
 * The transport is a discriminated union inside the agent's `config`, so a
 * later transport (phone) is a new member here rather than a new agent type or
 * a new component. No vendor name leaks past this module: everything else
 * speaks of a "voice" agent and a {@link VoiceTransport}, and only the
 * transport members name ElevenLabs.
 *
 * Contract-legal: schemas and pure functions over a stored config value, with
 * no persistence, no credential and no transport of its own. Both the drawer
 * and the server validate an agent's config against this one schema.
 */

import { z } from "zod";
import type { VoiceTransport } from "./voice-transport.ts";

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
