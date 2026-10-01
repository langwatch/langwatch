/**
 * VOICE_WORKER_ONLY job filter: admission predicate at execution pool.
 * Voice pool accepts only voice targets; refused jobs retry on pod with accepting pool.
 */

/** True when the run dials a voice target. */
export function isVoiceJob(jobData: { target: { type: string } }): boolean {
  return jobData.target.type === "voice";
}
