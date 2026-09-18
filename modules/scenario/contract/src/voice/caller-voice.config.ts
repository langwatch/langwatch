/** Caller-voice config on scenario (not agent): voice, interrupt behaviour,
 * audio effects; client-importable, vendor-agnostic, transport-independent.
 */

import { z } from "zod";

/**
 * The audio effects a caller can speak through. Vendor-agnostic names; the
 * child maps each to the SDK's audio-effect functions when it builds the
 * simulator.
 */
export const CALLER_VOICE_EFFECTS = ["none", "phone_line", "background_noise"] as const;
export type CallerVoiceEffect = (typeof CALLER_VOICE_EFFECTS)[number];

/**
 * The shape a caller `voiceModel` must take: `"provider/voice"`, one
 * non-empty segment each side of a slash. Validated by shape, not against a
 * catalog — the offered set is a UI concern (`CALLER_VOICES`), not a schema one.
 */
export const CALLER_VOICE_PATTERN = /^[^/\s]+\/[^/\s]+$/;

export const callerVoiceConfigSchema = z.object({
  /** `"provider/voice"` TTS voice; null means the project default voice. */
  voiceModel: z.string().regex(CALLER_VOICE_PATTERN).nullable().default(null),
  /** [0, 1] probability the caller interrupts each agent turn. UI shows a
   *  percent in steps of 5. */
  interruptProbability: z.number().min(0).max(1).default(0),
  effects: z.enum(CALLER_VOICE_EFFECTS).default("none"),
});
export type CallerVoiceConfig = z.infer<typeof callerVoiceConfigSchema>;

export const DEFAULT_CALLER_VOICE: CallerVoiceConfig = {
  voiceModel: null,
  interruptProbability: 0,
  effects: "none",
};

/**
 * Parse a stored `callerVoice` JSON value, tolerating the shapes a real
 * column carries — `null`/`undefined`, partial objects, even malformed
 * ones — all falling back to defaults rather than blocking the run.
 */
export const parseCallerVoiceConfig = (raw: unknown): CallerVoiceConfig => {
  if (raw === null || raw === undefined) return { ...DEFAULT_CALLER_VOICE };
  const result = callerVoiceConfigSchema.safeParse(raw);
  return result.success ? result.data : { ...DEFAULT_CALLER_VOICE };
};

/**
 * The voice a simulated caller speaks with when a scenario leaves it on
 * project default. Naming it here keeps the effective voice recorded on the
 * run (AC20), instead of an empty "default" the reader cannot interpret.
 */
export const DEFAULT_CALLER_VOICE_MODEL = "openai/nova";

/** A caller voice the picker may offer: its `"provider/voice"` value and the
 *  words a person reads for it. */
export interface CallerVoiceOption {
  provider: string;
  value: string;
  label: string;
}

/** The OpenAI TTS voice names the SDK's user simulator accepts. */
const OPENAI_CALLER_VOICE_NAMES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
] as const;

/** Explicit caller voice list (not derived from catalog): SDK needs voice name,
 * not model id; ElevenLabs voices are per-account, not listed here.
 */
export const CALLER_VOICES: CallerVoiceOption[] = OPENAI_CALLER_VOICE_NAMES.map((name) => ({
  provider: "openai",
  value: `openai/${name}`,
  label: name.charAt(0).toUpperCase() + name.slice(1),
}));
