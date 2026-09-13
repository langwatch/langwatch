/**
 * The voice worker's boot environment: the infra knobs the operator sets on
 * the worker deployment (#8014 env contract, issue comment 5603665345;
 * VOICE_TUNNEL added when the worker learned to discover its own public URL
 * rather than requiring one pre-configured).
 *
 *   - VOICE_WS_PORT         the TCP port the media listener binds (default 3300).
 *   - VOICE_PUBLIC_BASE_URL the public https origin Twilio dials back; the
 *                           worker derives wss://<host>/twilio/<nonce> from it.
 *                           An explicit value here always wins and is
 *                           validated as an https origin - this is the
 *                           stable-hostname production path. When it is
 *                           unset, the worker falls back to the tunnel below.
 *                           If that is disabled too, the worker comes up with
 *                           no public URL: tunnel provisioning is skipped, but
 *                           the media listener still boots and still binds
 *                           VOICE_WS_PORT - `voice-ws-listener` is an
 *                           unconditional stage of every worker's boot plan.
 *                           Only inbound reachability is lost, so voice runs
 *                           on this process fail rather than the whole worker.
 *                           A port conflict therefore still surfaces here, on
 *                           a worker that has no public URL at all.
 *   - VOICE_TUNNEL          the literal "false" (case-insensitive) turns off
 *                           the quick-tunnel fallback below; anything else,
 *                           including unset, leaves it on. Defaults ON
 *                           because a worker with nothing configured should
 *                           come up reachable rather than crash-loop, and an
 *                           operator who wants the stable-hostname production
 *                           path just sets VOICE_PUBLIC_BASE_URL, which always
 *                           takes precedence over the tunnel. When
 *                           VOICE_PUBLIC_BASE_URL is unset and this is on,
 *                           the worker opens a free cloudflared "quick
 *                           tunnel" at boot (see ./voice-public-url-tunnel)
 *                           and uses the resulting URL. This module only
 *                           reads the toggle; opening the tunnel is the
 *                           caller's job (startWorkers.ts), since it is async
 *                           and this parse is not.
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
 * Parse and validate the voice worker env. **Never throws**, on any input —
 * every worker now boots voice, so a misconfigured value must degrade the
 * voice subsystem for this process rather than kill the whole worker (see
 * {@link ../../workers/startWorkers}'s non-fatal tunnel/listener boot).
 *
 * That guarantee has to hold here rather than at the call site, because
 * `startWorkers` reads this BEFORE it enters the boot-stage `try` that makes
 * voice failures non-fatal. A throwing parse would take down a worker whose
 * other eight subsystems are healthy, over a typo in a voice port.
 *
 * So each malformed value falls back to its documented default and the worker
 * carries on:
 *
 *   - a VOICE_WS_PORT that is not a positive integer under 65536 falls back
 *     to {@link VOICE_WS_PORT_DEFAULT};
 *   - a VOICE_PUBLIC_BASE_URL that is not an https origin falls back to
 *     undefined, which sends the worker down the tunnel path exactly as if it
 *     had been left unset.
 */
export function readVoiceWorkerEnv(
  env: NodeJS.ProcessEnv = process.env,
): VoiceWorkerEnv {
  const port = portSchema.safeParse(env.VOICE_WS_PORT);
  const voiceWsPort = port.success
    ? (port.data as number)
    : VOICE_WS_PORT_DEFAULT;

  const rawPublicBaseUrl =
    env.VOICE_PUBLIC_BASE_URL?.trim() === ""
      ? undefined
      : env.VOICE_PUBLIC_BASE_URL;
  const publicBaseUrl = publicBaseUrlSchema.safeParse(rawPublicBaseUrl);
  const voicePublicBaseUrl = publicBaseUrl.success
    ? publicBaseUrl.data
    : undefined;

  const voiceTunnelEnabled =
    (env.VOICE_TUNNEL ?? "").trim().toLowerCase() !== "false";

  return {
    voiceWsPort,
    voicePublicBaseUrl,
    voiceTunnelEnabled,
  };
}
