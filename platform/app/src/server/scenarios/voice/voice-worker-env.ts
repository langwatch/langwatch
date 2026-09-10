/**
 * The voice worker's boot environment: the three infra knobs the operator sets
 * on the standalone voice worker deployment (#8014 env contract, issue comment
 * 5603665345).
 *
 *   - VOICE_WORKER_ONLY     the literal "true" turns this process into a voice
 *                           worker: it runs only voice scenario jobs and starts
 *                           the Twilio media listener. Anything else keeps the
 *                           current behaviour and starts no listener.
 *   - VOICE_WS_PORT         the TCP port the media listener binds (default 3300).
 *   - VOICE_PUBLIC_BASE_URL the public https origin Twilio dials back; the
 *                           worker derives wss://<host>/twilio/<nonce> from it.
 *                           Required when VOICE_WORKER_ONLY is on — the worker
 *                           refuses to start without it, because a listener no
 *                           call can reach is a silent misconfiguration.
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
 * but VOICE_PUBLIC_BASE_URL is missing or malformed — the "refuses to start"
 * clause of the env contract — so the worker fails loud at boot rather than
 * coming up with a listener Twilio can never reach.
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

	if (voiceWorkerOnly && voicePublicBaseUrl === undefined) {
		throw new Error(
			"VOICE_WORKER_ONLY is set but VOICE_PUBLIC_BASE_URL is missing; the voice worker refuses to start without a public https origin Twilio can dial back.",
		);
	}

	return { voiceWorkerOnly, voiceWsPort, voicePublicBaseUrl };
}
