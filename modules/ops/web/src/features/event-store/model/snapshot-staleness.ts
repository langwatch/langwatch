/**
 * When the page should stop calling itself live (ADR-090).
 *
 * Framework-free so the rule can be exercised directly rather than through a
 * rendered component — the decision is the thing worth pinning, not the badge
 * that displays it.
 */

/**
 * How old a snapshot may be before the indicator stops claiming "Live".
 *
 * Comfortably past the 2s live cadence and a lease handover, so an ordinary
 * writer changeover does not flicker a warning at an operator who has nothing
 * to do about it.
 */
export const SNAPSHOT_STALE_AFTER_MS = 30_000;

/**
 * Whether the numbers on the page are old enough to say so.
 *
 * A null `computedAtMs` means no snapshot has been read yet, which the page
 * already renders as its loading state — reporting that as stale would put an
 * age on data that does not exist.
 */
export function isSnapshotStale({
  computedAtMs,
  now,
}: {
  computedAtMs: number | null | undefined;
  now: number;
}): boolean {
  if (computedAtMs == null) return false;
  return now - computedAtMs >= SNAPSHOT_STALE_AFTER_MS;
}
