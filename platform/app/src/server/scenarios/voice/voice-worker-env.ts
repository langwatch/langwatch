/**
 * The voice worker's boot environment: the infra knobs the operator sets on
 * the standalone voice worker deployment (#8014 env contract, issue comment
 * 5603665345; VOICE_TUNNEL added when the worker learned to discover its own
 * public URL rather than requiring one pre-configured).
 *
 *   - VOICE_WORKER_ONLY     the literal "true" turns this process into a voice
 *                           worker: it runs only voice scenario jobs and starts
 *                           the Twilio media listener. Anything else keeps the
 *                           current behaviour and starts no listener.
 *   - VOICE_WS_PORT         the TCP port the media listener binds (default 3300).
 *   - VOICE_PUBLIC_BASE_URL the public https origin Twilio dials back; the
 *                           worker derives wss://<host>/twilio/<nonce> from it.
 *                           An explicit value here always wins and is
 *                           validated as an https origin - this is the
 *                           stable-hostname production path. When it is
 *                           unset AND VOICE_TUNNEL is disabled, the worker
 *                           refuses to start, because a listener no call can
 *                           reach is a silent misconfiguration.
 *   - VOICE_TUNNEL          the literal "false" (case-insensitive) turns off
 *                           the quick-tunnel fallback below; anything else,
 *                           including unset, leaves it on. Defaults ON
 *                           because the maintainer called this shape
 *                           temporary/ephemeral - a worker with nothing
 *                           configured should come up reachable rather than
 *                           crash-loop, and an operator who wants the
 *                           stable-hostname production path just sets
 *                           VOICE_PUBLIC_BASE_URL, which always takes
 *                           precedence over the tunnel. When
 *                           VOICE_PUBLIC_BASE_URL is unset and this is on,
 *                           the worker opens a free cloudflared "quick
 *                           tunnel" at boot (see ./voice-public-url-tunnel)
 *                           and uses the resulting URL instead of throwing.
 *                           This module only reads the toggle; opening the
 *                           tunnel is the caller's job (startWorkers.ts),
 *                           since it is async and this parse is not.
 *
 * The Twilio account credentials are deliberately NOT here: the maintainer
 * ruled them per-project platform data (provider or agent config, encrypted at
 * rest) delivered to the worker with the job, never operator env (env contract,
 * revised 2026-09-10).
 *
 * Read from `process.env` with zod rather than the app-wide validated schema,
 * for the same reason {@link ./voice-limits} reads its knobs there: the boot
 * path resolves this before the app graph evaluates, and both the worker and a
 * test can reach it without threading a config object.
 */

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
  /** False only for the literal "false" (case-insensitive); defaults true. */
  voiceTunnelEnabled: boolean;
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
 * Parse and validate the voice worker env. Throws when VOICE_WORKER_ONLY is on
 * but VOICE_PUBLIC_BASE_URL is missing or malformed and VOICE_TUNNEL is
 * disabled - the "refuses to start" clause of the env contract - so the
 * worker fails loud at boot rather than coming up with a listener Twilio can
 * never reach and no way to discover one. When VOICE_TUNNEL is left on (the
 * default) and VOICE_PUBLIC_BASE_URL is absent, this does NOT throw: the
 * caller is expected to open a quick tunnel and use its URL instead (see
 * ./voice-public-url-tunnel).
 */
export function readVoiceWorkerEnv(
  env: NodeJS.ProcessEnv = process.env,
): VoiceWorkerEnv {
  const voiceWorkerOnly =
    (env.VOICE_WORKER_ONLY ?? "").trim().toLowerCase() === "true";
  const voiceWsPort = portSchema.parse(env.VOICE_WS_PORT);
  const rawPublicBaseUrl =
    env.VOICE_PUBLIC_BASE_URL?.trim() === ""
      ? undefined
      : env.VOICE_PUBLIC_BASE_URL;
  const voicePublicBaseUrl = publicBaseUrlSchema.parse(rawPublicBaseUrl);
  const voiceTunnelEnabled =
    (env.VOICE_TUNNEL ?? "").trim().toLowerCase() !== "false";

  if (
    voiceWorkerOnly &&
    voicePublicBaseUrl === undefined &&
    !voiceTunnelEnabled
  ) {
    throw new Error(
      "VOICE_WORKER_ONLY is set but VOICE_PUBLIC_BASE_URL is missing and VOICE_TUNNEL is disabled; the voice worker refuses to start without a public https origin Twilio can dial back.",
    );
  }

  return { voiceWorkerOnly, voiceWsPort, voicePublicBaseUrl, voiceTunnelEnabled };
}
