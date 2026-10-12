import {
  E164_PHONE_PATTERN,
  voiceAgentConfigSchema,
  voiceTransportSchema,
  type VoiceAgentConfig,
  type VoiceTransport,
} from "@langwatch/agent-contract";

/** "inbound" answers and greets first; "outbound" places the call and waits. */
export type CallDirection = "inbound" | "outbound";

export type VoiceForm = {
  name: string;
  transport: VoiceTransport;
  voiceAgentId: string;
  phoneNumber: string;
  callDirection: CallDirection;
};

export const DEFAULT_TRANSPORT: VoiceTransport = "elevenlabs_convai";

export const DEFAULT_CALL_DIRECTION: CallDirection = "outbound";

export const VOICE_TRANSPORTS: readonly VoiceTransport[] = voiceTransportSchema.options;

export const VOICE_TRANSPORT_LABELS: Record<VoiceTransport, string> = {
  elevenlabs_convai: "ElevenLabs agent",
  phone: "Phone number",
};

export const EMPTY_VOICE_FORM: VoiceForm = {
  name: "",
  transport: DEFAULT_TRANSPORT,
  voiceAgentId: "",
  phoneNumber: "",
  callDirection: DEFAULT_CALL_DIRECTION,
};

/** The form a saved agent seeds; a config that no longer parses seeds the defaults. */
export function formFromAgent(agent: { name?: string | null; config?: unknown }): VoiceForm {
  const parsed = voiceAgentConfigSchema.safeParse(agent.config ?? {});
  const base = { ...EMPTY_VOICE_FORM, name: agent.name ?? "" };
  if (!parsed.success) return base;
  const config = parsed.data;
  if (config.transport === "phone") {
    return {
      ...base,
      transport: "phone",
      phoneNumber: config.phoneNumber,
      callDirection: config.callDirection,
    };
  }
  return { ...base, transport: config.transport, voiceAgentId: config.agentId };
}

export function isValidPhoneNumber(phoneNumber: string): boolean {
  return E164_PHONE_PATTERN.test(phoneNumber.trim());
}

/** Name plus the transport's own identity: an E.164 number, or an agent id. */
export function isVoiceFormValid(form: VoiceForm): boolean {
  if (form.name.trim().length === 0) return false;
  if (form.transport === "phone") return isValidPhoneNumber(form.phoneNumber);
  return form.voiceAgentId.trim().length > 0;
}

/** The stored config for the form; a phone target never carries an agent id. */
export function voiceConfigOf(form: VoiceForm): VoiceAgentConfig {
  if (form.transport === "phone") {
    return {
      transport: "phone",
      phoneNumber: form.phoneNumber.trim(),
      callDirection: form.callDirection,
    };
  }
  return { transport: form.transport, agentId: form.voiceAgentId.trim() };
}

export function isVoiceTransport(value: string): value is VoiceTransport {
  return voiceTransportSchema.validate(value);
}
