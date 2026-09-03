// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Identifiers for the daily governance cost rollup (ADR-128 wave 1).
 *
 * The fold is registered on TWO pipelines — gateway spend and pulled usage —
 * so its name, version and table live here rather than under either pipeline's
 * own `schemas/`.
 */

export const GOVERNANCE_COST_ROLLUP_PROJECTION_NAME = "governanceCostRollup";

/**
 * Schema-snapshot version of the fold (calendar date). The projected row
 * stamps it; the store's read-back only trusts rows carrying the current
 * stamp, so a row written by an older shape reads as a miss rather than
 * decoding column defaults into wrong state.
 */
export const GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST = "2026-08-28";

export const GOVERNANCE_COST_ROLLUP_TABLE = "governance_cost_rollup_1d";

/**
 * Which lane the money came from.
 *
 * The trace lane is RESERVED and excluded from wave 1: ADR-128 keeps trace
 * cost a separate system (per-request Float64 in `trace_summaries`), and no
 * pipeline carrying trace cost registers this fold, so no row can ever carry a
 * trace cost source.
 */
export const GOVERNANCE_COST_SOURCE = {
  GATEWAY: "gateway",
  PULLED: "pulled",
} as const;
export type GovernanceCostSource =
  (typeof GOVERNANCE_COST_SOURCE)[keyof typeof GOVERNANCE_COST_SOURCE];

/**
 * The currency both wave-1 producers state their figures in. It is a KEY
 * column so that the first non-USD producer is a new row rather than a new
 * sort key — changing a sort key means rebuilding the table.
 */
export const GOVERNANCE_COST_CURRENCY_USD = "USD";

/**
 * How long after a pull last touched a day that day may still move (ADR-128
 * §15).
 *
 * MEASURED FOR ANTHROPIC ONLY, which is why this is a default rather than a
 * fact: Anthropic restates cost for up to 30 days. Azure's and Databricks'
 * windows have not been probed, so they run on this number until somebody
 * measures them — the per-source override below is what makes measuring one
 * not a re-decision about the others.
 *
 * No provider tells us a day is final. FOCUS's `ChargeClass="Correction"`
 * describes only periods that have already closed, so nothing on the wire
 * says "settled" and the flag has to be derived from how long ago we last
 * looked.
 */
export const GOVERNANCE_SETTLING_WINDOW_DAYS = 30;

/**
 * Per-source overrides of the window above, keyed by the pulled source name
 * (`Provider` on a pulled row, e.g. `anthropic_admin`).
 *
 * Empty on purpose. Every source runs on the default until its window is
 * actually measured, and an entry here is the record that one was.
 */
const GOVERNANCE_SETTLING_WINDOW_DAYS_BY_SOURCE: Readonly<
  Record<string, number>
> = {};

/** The settling window a source's days are judged against. */
export function settlingWindowDaysForSource(source: string): number {
  return (
    GOVERNANCE_SETTLING_WINDOW_DAYS_BY_SOURCE[source] ??
    GOVERNANCE_SETTLING_WINDOW_DAYS
  );
}
