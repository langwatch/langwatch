/**
 * Deterministic percentage bucketing using FNV-1a hash (32-bit with Math.imul). Ensures
 * independence (subjects bucketed independently per flag) and monotonicity (raising
 * percentage only adds subjects). Portable across browser, worker, and API.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Buckets per flag, one per whole percent, as production has always assigned them. */
export const BUCKET_COUNT = 100;

export function hashFeatureFlagSubject(value: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }

  // `>>> 0` reads the 32 bits back as unsigned; Math.imul yields a signed int.
  return hash >>> 0;
}

/** The subject's bucket for one flag, in `[0, BUCKET_COUNT)`. */
export function bucketForSubject({
  flagKey,
  subject,
}: {
  flagKey: string;
  subject: string;
}): number {
  return hashFeatureFlagSubject(`${flagKey}:${subject}`) % BUCKET_COUNT;
}

/**
 * Whether the subject falls inside a whole-percent rollout. 0 admits
 * nobody, 100 admits everybody. A target with no bucketing subject
 * (system, non-person) never satisfies it, rather than acting as bucket zero.
 */
export function isWithinRolloutPercentage({
  flagKey,
  subject,
  percentage,
}: {
  flagKey: string;
  subject: string | undefined;
  percentage: number;
}): boolean {
  if (!subject || !flagKey) return false;
  if (percentage <= 0) return false;
  if (percentage >= 100) return true;

  return bucketForSubject({ flagKey, subject }) < percentage * (BUCKET_COUNT / 100);
}
