import type { VoiceTransport } from "@langwatch/agent-contract";

import { VOICE_TRANSPORTS, VOICE_TRANSPORT_LABELS } from "./voice-form.ts";

/** The settings route that adds a model provider key. Top-level, no slug. */
export const MODEL_PROVIDERS_ROUTE = "/settings/model-providers";

/** The release flag every voice surface reads (AC29). */
export const VOICE_AGENTS_FLAG_KEY = "release_voice_agents_enabled";

type TalkPrerequisites = {
  transport: VoiceTransport;
  voiceAgentId: string;
  hasElevenLabsKey: boolean;
};

/** The tooltip naming whichever "Talk to it" prerequisite is still missing. */
export function talkTooltipFor({
  transport,
  voiceAgentId,
  hasElevenLabsKey,
}: TalkPrerequisites): string | undefined {
  if (transport === "phone") {
    return "Browser calls are not available for phone targets. Call it from a scenario run.";
  }
  if (voiceAgentId.trim().length === 0) return "Enter the agent id first";
  if (!hasElevenLabsKey) return "Add an ElevenLabs key first";
  return void 0;
}

export function canTalkTo(prerequisites: TalkPrerequisites): boolean {
  return talkTooltipFor(prerequisites) === void 0;
}

export type TransportOption = { value: VoiceTransport; label: string; disabled: boolean };

/**
 * Every transport is listed; phone is disabled and marked Unavailable without
 * a Twilio provider, unless the agent is already a phone target.
 */
export function transportOptionsFor({
  hasTwilioKey,
  transport,
}: {
  hasTwilioKey: boolean;
  transport: VoiceTransport;
}): readonly TransportOption[] {
  return VOICE_TRANSPORTS.map((value) => {
    const disabled = value === "phone" && !hasTwilioKey && transport !== "phone";
    const label = VOICE_TRANSPORT_LABELS[value];
    return { value, label: disabled ? `${label} (Unavailable)` : label, disabled };
  });
}

/** The Add-key detour carries the current address back so the draft is found again. */
export function addKeyHref(returnTo: string | undefined): string {
  if (!returnTo) return MODEL_PROVIDERS_ROUTE;
  return `${MODEL_PROVIDERS_ROUTE}?returnTo=${encodeURIComponent(returnTo)}`;
}
