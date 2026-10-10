import type { Named } from "@langwatch/module";
import { z } from "zod";

export const voiceTransportSchema = z.enum(["elevenlabs_convai", "phone"]);
export type VoiceTransport = z.infer<typeof voiceTransportSchema>;

const elevenLabsConvaiTransportSchemaDefinition = z.object({
  transport: z.literal("elevenlabs_convai"),
  agentId: z.string().trim().min(1, "Agent id is required").max(128),
});
export interface ElevenLabsConvaiTransportSchema extends Named<
  typeof elevenLabsConvaiTransportSchemaDefinition
> {}
export const elevenLabsConvaiTransportSchema: ElevenLabsConvaiTransportSchema =
  elevenLabsConvaiTransportSchemaDefinition;

export const E164_PHONE_PATTERN = /^\+[1-9]\d{1,14}$/;

const phoneTransportSchemaDefinition = z.object({
  transport: z.literal("phone"),
  phoneNumber: z
    .string()
    .trim()
    .regex(E164_PHONE_PATTERN, "Enter the number in E.164 form, like +14155550123"),
  /**
   * Which way the call goes, which decides who speaks first: "inbound" opens
   * with the agent's own turn (it greets on connect); "outbound" (default)
   * opens with the caller, once the agent places the call.
   */
  callDirection: z.enum(["inbound", "outbound"]).default("outbound"),
});
export interface PhoneTransportSchema extends Named<typeof phoneTransportSchemaDefinition> {}
export const phoneTransportSchema: PhoneTransportSchema = phoneTransportSchemaDefinition;

const voiceAgentConfigUnion = z.discriminatedUnion("transport", [
  elevenLabsConvaiTransportSchema,
  phoneTransportSchema,
]);

/**
 * Maps a stored config's legacy `isAgentSpeaksFirst`/`agentSpeaksFirst`
 * booleans onto `callDirection: "inbound"` and strips the legacy keys; an
 * explicit `callDirection` always wins.
 */
function normalizeLegacyVoiceConfig(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return input;
  }
  const source = input as Record<string, unknown>;
  const isLegacyInboundRequested =
    source.callDirection === undefined &&
    (source.isAgentSpeaksFirst === true || source.agentSpeaksFirst === true);
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "isAgentSpeaksFirst" || key === "agentSpeaksFirst") continue;
    normalized[key] = value;
  }
  if (isLegacyInboundRequested) normalized.callDirection = "inbound";
  return normalized;
}

export const voiceAgentConfigSchema = z.preprocess(
  normalizeLegacyVoiceConfig,
  voiceAgentConfigUnion,
);
export type VoiceAgentConfig = z.infer<typeof voiceAgentConfigSchema>;

export const parseVoiceAgentConfig = (config: unknown): VoiceAgentConfig =>
  voiceAgentConfigSchema.parse(config);

export const voiceAgentExternalId = (config: VoiceAgentConfig): string => {
  switch (config.transport) {
    case "elevenlabs_convai":
      return config.agentId;
    case "phone":
      return config.phoneNumber;
  }
};

export const voiceAgentIdentityKey = ({
  transport,
  agentExternalId,
}: {
  transport: VoiceTransport;
  agentExternalId: string;
}): string => `voice:${transport}:${agentExternalId}`;
