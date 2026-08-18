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
} as const;

export const PULLED_USAGE_PROCESSING_EVENT_TYPES = [
  PULLED_USAGE_EVENT_TYPES.OBSERVED,
] as const;

export type PulledUsageProcessingEventType =
  (typeof PULLED_USAGE_PROCESSING_EVENT_TYPES)[number];

export const PULLED_USAGE_COMMAND_TYPES = {
  RECORD: "lw.obs.pulled_usage.record",
} as const;

export const PULLED_USAGE_PROCESSING_COMMAND_TYPES = [
  PULLED_USAGE_COMMAND_TYPES.RECORD,
] as const;

export type PulledUsageProcessingCommandType =
  (typeof PULLED_USAGE_PROCESSING_COMMAND_TYPES)[number];

/** Event schema versions using calendar versioning (YYYY-MM-DD). */
export const PULLED_USAGE_EVENT_VERSIONS = {
  OBSERVED: "2026-08-06",
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
