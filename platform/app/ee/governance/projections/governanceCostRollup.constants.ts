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
