/**
 * Deterministic percentage bucketing.
 *
 * A subject's bucket depends on the flag key and the subject alone, never on
 * the rollout percentage. Two properties follow, and both are load-bearing:
 *
 *   - Independence. Hashing the flag key in means a subject in the first 10%
 *     of one flag is not thereby in the first 10% of every other flag, so
 *     staged rollouts do not all land on the same unlucky people.
 *   - Monotonicity. Raising a percentage only ever adds subjects, so nobody
 *     loses a feature because the rollout widened.
 *
 * The hash is FNV-1a, 32-bit, written with `Math.imul` so the arithmetic
 * stays exactly 32-bit in every JavaScript runtime. It is portable on
 * purpose: the same bucket must come out in the browser, in a worker and in
 * the API, with no native dependency.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Buckets per flag. 10,000 gives whole-percent rollouts 100 buckets each. */
export const BUCKET_COUNT = 10_000;

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
 * Whether the subject falls inside a whole-percent rollout.
 *
 * `percentage` 0 admits nobody and 100 admits everybody. A target with no
 * bucketing subject — a system target, or any backend caller that is not a
 * person — never satisfies a percentage rule, rather than being treated as
 * bucket zero.
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
  if (subject === undefined) return false;
  if (percentage <= 0) return false;
  if (percentage >= 100) return true;

  return bucketForSubject({ flagKey, subject }) < percentage * (BUCKET_COUNT / 100);
}
