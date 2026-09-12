/**
 * The VOICE_WORKER_ONLY job filter.
 *
 * There is one scenario queue, not a voice-specific one, so "consume only the
 * voice queue" is expressed as an admission predicate at the execution pool
 * rather than a separate BullMQ queue name: a voice worker's pool accepts a job
 * only when its target is a voice target, and refuses everything else. A refused
 * job is handed back to the process outbox (see
 * {@link ./execution-pool.JobNotAcceptedByPoolError}), which retries it on a pod
 * whose pool does accept it.
 *
 * The discriminator is the run's own `target.type`, the same field the pool's
 * voice concurrency gate already keys on, so the two agree by construction.
 */

import type { ExecutionJobData } from "./__tests__/execution-pool.unit.test.ts";

/** True when the run dials a voice target. */
export function isVoiceJob(jobData: ExecutionJobData): boolean {
  return jobData.target.type === "voice";
}
