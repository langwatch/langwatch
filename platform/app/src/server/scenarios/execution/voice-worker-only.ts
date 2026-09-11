/**
 * The VOICE_WORKER_ONLY job filters.
 *
 * There is one scenario queue, not a voice-specific one, so "consume only the
 * voice queue" (and its mirror, "never consume the voice queue") is expressed
 * as an admission predicate at the execution pool rather than a separate
 * BullMQ queue name: a voice worker's pool accepts a job only when its target
 * is a voice target, and a normal worker's pool refuses one. A refused job is
 * handed back to the process outbox (see
 * {@link ./execution-pool.JobNotAcceptedByPoolError}), which retries it on a
 * pod whose pool does accept it.
 *
 * The two predicates are exact complements — {@link isVoiceJob} and
 * {@link isNotVoiceJob} — so every job is accepted by exactly one kind of
 * worker. That exactness is load-bearing, not cosmetic: a voice job that a
 * normal worker's pool accepts still runs (the scenario processor boots on
 * every worker), but the media listener that authenticates Twilio's dial-back
 * boots only on a voice worker (VOICE_WORKER_ONLY, see
 * `workers/worker-boot-plan.ts`). The phone transport's nonce registration
 * lives in the same in-process registry the listener reads
 * ({@link ../voice/voice-nonce-registry}), which only works when both run in
 * the same process — so a voice job landing on a normal worker registers a
 * nonce nothing will ever look up, and the real Twilio call is refused 403.
 *
 * The discriminator is the run's own `target.type`, the same field the pool's
 * voice concurrency gate already keys on, so the two agree by construction.
 */

import type { ExecutionJobData } from "./execution-pool";

/** True when the run dials a voice target. Installed as the voice worker's
 *  `acceptJob` predicate. */
export function isVoiceJob(jobData: ExecutionJobData): boolean {
  return jobData.target.type === "voice";
}

/** True when the run does NOT dial a voice target — the exact complement of
 *  {@link isVoiceJob}. Installed as a normal (non-voice) worker's `acceptJob`
 *  predicate, so a voice job is never accepted anywhere but a voice worker. */
export function isNotVoiceJob(jobData: ExecutionJobData): boolean {
  return !isVoiceJob(jobData);
}
