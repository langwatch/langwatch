/**
 * The caller-voice configuration a scenario carries for a voice target.
 *
 * This is the simulated caller's own voice, interrupt behaviour and audio
 * effects — it lives on the SCENARIO, never on the agent, because the same
 * voice agent is phoned by different personas across scenarios.
 *
 * Client-importable (the ScenarioForm validates against the same schema the
 * server persists with), so this module stays free of server-only imports and
 * of any vendor name: the transport layer owns ElevenLabs, and the caller's
 * voice is a user-simulator TTS voice in `"provider/voice"` form (e.g.
 * `"openai/nova"`), independent of which transport reaches the agent.
 */

import { z } from "zod";

/**
 * The audio effects a caller can speak through. Vendor-agnostic names; the
 * child maps each to the SDK's audio-effect functions when it builds the
 * simulator.
 */
export const CALLER_VOICE_EFFECTS = [
  "none",
  "phone_line",
  "background_noise",
] as const;
export type CallerVoiceEffect = (typeof CALLER_VOICE_EFFECTS)[number];

export const callerVoiceConfigSchema = z.object({
  /** litellm-style `"provider/voice"`; null means the project default voice. */
  voiceModel: z.string().min(1).nullable().default(null),
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
 * Parse a stored `callerVoice` JSON value into a config, tolerating the shapes
 * a real column carries: `null`/`undefined` (never set) and partial objects
 * (queued before a field existed) both fall back to defaults rather than
 * throwing. An outright malformed object is coerced to defaults too, so a run
 * queued against a scenario is never blocked by a bad caller-voice blob.
 */
export const parseCallerVoiceConfig = (raw: unknown): CallerVoiceConfig => {
  if (raw === null || raw === undefined) return { ...DEFAULT_CALLER_VOICE };
  const result = callerVoiceConfigSchema.safeParse(raw);
  return result.success ? result.data : { ...DEFAULT_CALLER_VOICE };
};

/**
 * The voice the simulated caller speaks with when the scenario leaves it on the
 * project default. The SDK's user simulator falls back to an OpenAI TTS voice
 * when none is set; naming it here keeps the effective voice recorded on the
 * run (AC20) instead of an empty "default" the reader cannot interpret.
 */
export const DEFAULT_CALLER_VOICE_MODEL = "openai/nova";

/**
 * Whether a model may be offered in the caller Voice picker: it must be one the
 * project has credentials for AND tagged for spoken audio (`audio`, or
 * `realtime` once the catalog carries it). The chat/embedding pickers use their
 * own modes and are unaffected.
 */
export interface VoiceModelCandidate {
  mode: string;
  hasCredentials: boolean;
}
export const VOICE_MODEL_MODES: ReadonlySet<string> = new Set([
  "audio",
  "realtime",
]);
export const isSelectableVoiceModel = (
  candidate: VoiceModelCandidate,
): boolean => candidate.hasCredentials && VOICE_MODEL_MODES.has(candidate.mode);
