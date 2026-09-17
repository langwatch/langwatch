/**
 * VOICE_WORKER_ONLY job filter: admission predicate at execution pool.
 * Voice pool accepts only voice targets; refused jobs retry on pod with accepting pool.
 */

import type { ExecutionJobData } from "./services/scenario-execution-pool.service.ts";

/** True when the run dials a voice target. */
export function isVoiceJob(jobData: ExecutionJobData): boolean {
  return jobData.target.type === "voice";
}
