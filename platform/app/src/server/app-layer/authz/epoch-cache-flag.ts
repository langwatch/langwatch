/**
 * ADR-092 §12 — how the L1 grants cache reads its kill switch.
 *
 * A module of its own so the parse can be tested directly: runtime.ts is the
 * composition root, and importing it pulls Prisma, redis and the EE audit
 * writer into whatever imports it. Nothing but runtime.ts imports this; it is
 * not re-exported anywhere.
 */

/**
 * Every spelling of "off" this reads. Whitespace and casing are normalised
 * away before the lookup, so an operator reaching for the kill switch during
 * an incident is not defeated by `FALSE` or by a stray space in a manifest.
 */
const OFF_VALUES = new Set(["0", "false", "off", "no"]);

/**
 * Whether the epoch cache is consulted, given the raw `AUTHZ_EPOCH_CACHE`
 * value.
 *
 * On unless an operator turns it off. ADR-110 finished: every organization
 * resolves through the engine, so every check pays 3-5 database reads that
 * the epoch already tells us are unnecessary. The cache is bounded twice
 * over - by the organization's epoch and by an absolute age - so turning it
 * off buys no correctness, only fresh reads.
 *
 * A value we still do not recognise leaves the cache on, which fails toward
 * the default rather than toward a silently hot database path. That is the
 * cheap direction to be wrong in. The expensive one is a kill switch that
 * quietly does nothing, which is why the four spellings above are trimmed
 * and lowercased rather than matched exactly.
 */
export function isEpochCacheEnabled(raw: string | undefined): boolean {
  return !OFF_VALUES.has((raw ?? "").trim().toLowerCase());
}
