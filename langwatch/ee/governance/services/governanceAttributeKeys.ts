// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Single source-of-truth for the OTel attribute keys the governance
 * pipeline reads + writes. The receiver (ingestionRoutes.ts) stamps
 * these on every span produced by an IngestionSource, the trace-
 * attribute-accumulation projection hoists them into trace_summaries,
 * and the read paths (reactors + activityMonitor service) filter on
 * them.
 *
 * Hard-coding these strings in 3+ places is exactly how the
 * write/read paths silently diverge (cf. the puller-tenancy bug
 * fixed in eb221e348). Anchor them once.
 *
 * NOTE: the trace-pipeline projection at
 * src/server/event-sourcing/pipelines/trace-processing/projections/
 *   services/trace-attribute-accumulation.service.ts also references
 * these keys verbatim. Keep that list in sync if you add an attribute
 * here that needs to be hoisted from spans into trace_summaries.
 */

/** "ingestion_source" — the only ORIGIN_KIND_VALUE the governance reactors fire on. */
export const GOVERNANCE_ORIGIN_KIND_VALUE = "ingestion_source" as const;

export const GOVERNANCE_ATTR = {
  /** "langwatch.origin.kind" — discriminator the reactors filter on. */
  ORIGIN_KIND: "langwatch.origin.kind",
  /** "langwatch.ingestion_source.id" — IngestionSource.id of the source that produced the trace. */
  INGESTION_SOURCE_ID: "langwatch.ingestion_source.id",
  /** "langwatch.ingestion_source.source_type" — sourceType label (otel_generic / claude_compliance / etc). */
  INGESTION_SOURCE_TYPE: "langwatch.ingestion_source.source_type",
  /** "langwatch.ingestion_source.organization_id" — owner org of the source. */
  INGESTION_SOURCE_ORG_ID: "langwatch.ingestion_source.organization_id",
  /** "langwatch.user_id" — actor (typically email) attribution for SpendByUser. */
  USER_ID: "langwatch.user_id",
  /** "langwatch.governance.anomaly_alert_id" — set by alertTrigger reactor to elevate OCSF severity. */
  ANOMALY_ALERT_ID: "langwatch.governance.anomaly_alert_id",
} as const;

export type GovernanceAttrKey =
  (typeof GOVERNANCE_ATTR)[keyof typeof GOVERNANCE_ATTR];
