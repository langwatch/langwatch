/**
 * Exponential backoff with full jitter for outbox retries.
 *
 * Schedule (base 1s, factor 2, cap 30 min): 1s → 2s → 4s → 8s → 16s →
 * 32s → 1m4s → 2m8s → 4m16s → 8m32s → 17m4s → 30m (capped).
 *
 * Full jitter (random between [0, exponential]) spreads herds when many
 * rows fail simultaneously (e.g. provider outage recovers and 1000 rows
 * all want to retry at the same nextAttemptAt).
 */
export const DEFAULT_BACKOFF_BASE_MS = 1_000;
export const DEFAULT_BACKOFF_FACTOR = 2;
export const DEFAULT_BACKOFF_CAP_MS = 30 * 60 * 1_000;

export function calculateBackoffMs({
  attempts,
  baseMs = DEFAULT_BACKOFF_BASE_MS,
  factor = DEFAULT_BACKOFF_FACTOR,
  capMs = DEFAULT_BACKOFF_CAP_MS,
  random = Math.random,
}: {
  /** Number of attempts already made (including the one that just failed). */
  attempts: number;
  baseMs?: number;
  factor?: number;
  capMs?: number;
  /** Injectable for deterministic tests. */
  random?: () => number;
}): number {
  if (attempts < 1) return 0;
  const exponential = Math.min(baseMs * factor ** (attempts - 1), capMs);
  return Math.floor(random() * exponential);
}
