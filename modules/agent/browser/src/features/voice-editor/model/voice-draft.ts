import {
  DEFAULT_TRANSPORT,
  EMPTY_VOICE_FORM,
  isVoiceTransport,
  type VoiceForm,
} from "./voice-form.ts";

/**
 * What survives the detour to add a key. The phone number is a personal
 * identifier and is never persisted; the call direction is phone-only.
 */
export type VoiceDraft = Pick<VoiceForm, "name" | "transport" | "voiceAgentId">;

export const voiceDraftKey = (projectId: string) => `voice-agent-draft:${projectId}`;

export function serializeVoiceDraft(form: VoiceForm): string {
  return JSON.stringify({ name: form.name, transport: form.transport, agentId: form.voiceAgentId });
}

/** A stored draft read back; anything unrecognisable reads as no draft. */
export function parseVoiceDraft(raw: string | null | undefined): VoiceDraft | undefined {
  if (!raw) return void 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return void 0;
  }
  if (typeof parsed !== "object" || parsed === null) return void 0;
  if (!("name" in parsed) || !("agentId" in parsed)) return void 0;
  const { name, agentId } = parsed;
  if (typeof name !== "string" || typeof agentId !== "string") return void 0;
  const transport =
    "transport" in parsed &&
    typeof parsed.transport === "string" &&
    isVoiceTransport(parsed.transport)
      ? parsed.transport
      : DEFAULT_TRANSPORT;
  return { name, transport, voiceAgentId: agentId };
}

export function formFromDraft(draft: VoiceDraft | undefined): VoiceForm {
  return { ...EMPTY_VOICE_FORM, ...draft };
}
