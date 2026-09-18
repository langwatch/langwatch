// Voice worker boot env: VOICE_WORKER_ONLY, VOICE_WS_PORT (default 3300), VOICE_PUBLIC_BASE_URL.
// Twilio credentials are per-project platform data, not env.

import { z } from "zod";

export const VOICE_WS_PORT_DEFAULT = 3300;

/** Parsed, validated voice worker boot config. */
export interface VoiceWorkerEnv {
  /** True only for the literal "true" (case-insensitive); see the contract. */
  voiceWorkerOnly: boolean;
  /** The media listener's TCP port. */
  voiceWsPort: number;
  /** The public https origin Twilio dials back, or undefined when unset. */
  voicePublicBaseUrl: string | undefined;
}

const portSchema = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.coerce.number().int().positive().max(65535).default(VOICE_WS_PORT_DEFAULT),
);

const publicBaseUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), {
    message: "VOICE_PUBLIC_BASE_URL must be an https origin",
  })
  .optional();

/**
 * Parse and validate the voice worker env. Throws when VOICE_WORKER_ONLY is
 * on but VOICE_PUBLIC_BASE_URL is missing or malformed, so the worker fails
 * loud at boot rather than coming up with a listener Twilio can never reach.
 */
export function readVoiceWorkerEnv(env: NodeJS.ProcessEnv): VoiceWorkerEnv {
  const voiceWorkerOnly = (env.VOICE_WORKER_ONLY ?? "").trim().toLowerCase() === "true";
  const voiceWsPort = portSchema.parse(env.VOICE_WS_PORT);
  const rawPublicBaseUrl =
    env.VOICE_PUBLIC_BASE_URL?.trim() === "" ? undefined : env.VOICE_PUBLIC_BASE_URL;
  const voicePublicBaseUrl = publicBaseUrlSchema.parse(rawPublicBaseUrl);

  if (voiceWorkerOnly && voicePublicBaseUrl === undefined) {
    throw new Error(
      "VOICE_WORKER_ONLY is set but VOICE_PUBLIC_BASE_URL is missing; the voice worker refuses to start without a public https origin Twilio can dial back.",
    );
  }

  return { voiceWorkerOnly, voiceWsPort, voicePublicBaseUrl };
}
