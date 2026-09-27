/**
 * The pre-split stamp — DECODED in place, not a store miss: rejecting it
 * would re-anchor the whole population from replay (ADR-071 consequences
 * 1-3). `OccurredAt` doubles as the correct `EarliestSpanStartMs` here.
 */
export const TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT = "2026-07-27" as const;
