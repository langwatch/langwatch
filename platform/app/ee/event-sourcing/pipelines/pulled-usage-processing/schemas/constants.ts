// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Identifiers for the `pulled_usage` aggregate (ADR-088).
 *
 * One stream per pulled usage ITEM, not per pull run. The shipped
 * `ingestion_pull` aggregate is per-source and its RUN_COMPLETED carries only
 * an event count, so it cannot hold a priced record; this is its sibling, and
 * the two stay separate on purpose.
 */

export const PULLED_USAGE_PIPELINE_NAME = "pulled_usage_processing" as const;
export const PULLED_USAGE_AGGREGATE_TYPE = "pulled_usage" as const;

export const PULLED_USAGE_EVENT_TYPES = {
  OBSERVED: "lw.obs.pulled_usage.observed",
  /**
   * Withdraws what one restatement key holds in the cell it currently sits in.
   *
   * Emitted when a provider reissues a charge under a dimension the
   * restatement key deliberately excludes -- the currency, the agent, the
   * spender it named. Those land in a DIFFERENT rollup cell, so without this
   * the first version is left behind holding its money with nothing to say it
   * was superseded, and a total across the day carries the one bill twice.
   */
  RETRACTED: "lw.obs.pulled_usage.retracted",
} as const;

export const PULLED_USAGE_PROCESSING_EVENT_TYPES = [
  PULLED_USAGE_EVENT_TYPES.OBSERVED,
  PULLED_USAGE_EVENT_TYPES.RETRACTED,
] as const;

export type PulledUsageProcessingEventType =
  (typeof PULLED_USAGE_PROCESSING_EVENT_TYPES)[number];

export const PULLED_USAGE_COMMAND_TYPES = {
  RECORD: "lw.obs.pulled_usage.record",
  /**
   * Withdraws the version of a charge that a later pull superseded.
   *
   * Separate from RECORD rather than a flag on it because the two carry
   * different addresses: RECORD names the cell the charge is landing in, and
   * this names the cell it is leaving. One command that meant both would have
   * to guess which of its dimensions were the address.
   */
  RETRACT: "lw.obs.pulled_usage.retract",
} as const;

export const PULLED_USAGE_PROCESSING_COMMAND_TYPES = [
  PULLED_USAGE_COMMAND_TYPES.RECORD,
  PULLED_USAGE_COMMAND_TYPES.RETRACT,
] as const;

export type PulledUsageProcessingCommandType =
  (typeof PULLED_USAGE_PROCESSING_COMMAND_TYPES)[number];

/** Event schema versions using calendar versioning (YYYY-MM-DD). */
export const PULLED_USAGE_EVENT_VERSIONS = {
  OBSERVED: "2026-08-06",
  RETRACTED: "2026-09-09",
} as const;

/**
 * Where the money figure came from. `provider_reported` means the provider
 * handed us a cost and we carried it; `computed` means the provider handed us
 * quantities and we priced them once, at the ingest seam.
 */
export const PULLED_USAGE_COST_BASIS = {
  PROVIDER_REPORTED: "provider_reported",
  COMPUTED: "computed",
} as const;
export type PulledUsageCostBasis =
  (typeof PULLED_USAGE_COST_BASIS)[keyof typeof PULLED_USAGE_COST_BASIS];

/**
 * How final the figure is. `exact` is the number the provider will invoice;
 * `estimate` is a pre-invoice figure, whether we priced it or the provider
 * gave a metered-unit approximation.
 */
export const PULLED_USAGE_COST_STATUS = {
  EXACT: "exact",
  ESTIMATE: "estimate",
} as const;
export type PulledUsageCostStatus =
  (typeof PULLED_USAGE_COST_STATUS)[keyof typeof PULLED_USAGE_COST_STATUS];
