/**
 * Direction of a retroactive retention change, used to decide whether applying
 * a new retention to a project's EXISTING data is destructive and therefore
 * needs explicit confirmation.
 *
 * Retention is "longest wins": `0` means indefinite (kept forever), so it sorts
 * as the largest possible window. Shrinking the window — including moving away
 * from indefinite to any finite day count — makes older rows eligible for
 * deletion on the next merge and must be confirmed. Growing it (or leaving it
 * unchanged) never deletes anything and is safe to apply immediately.
 */
export type RetentionChangeKind = "expansion" | "contraction" | "noop";

/** Indefinite retention (0) is the longest possible window. */
const asWindow = (days: number): number =>
  days <= 0 ? Number.POSITIVE_INFINITY : days;

/**
 * Classify applying `next` retention to data that currently carries `current`.
 *
 * - `contraction` — the window shrank; existing data becomes deletable. Confirm.
 * - `expansion`   — the window grew; nothing is deleted. Safe.
 * - `noop`        — unchanged; the retroactive UPDATE would be a no-op.
 */
export function classifyRetentionChange({
  current,
  next,
}: {
  current: number;
  next: number;
}): RetentionChangeKind {
  const from = asWindow(current);
  const to = asWindow(next);
  if (to < from) return "contraction";
  if (to > from) return "expansion";
  return "noop";
}
