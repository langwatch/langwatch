import { tenantScope, tenantSet } from "@langwatch/clickhouse-client";

/**
 * How a legacy trace_summaries statement names its tenants. A timeseries, top documents and
 * feedbacks read through the proof (ADR-177): the window applies once, on `OccurredAt`, and a
 * side table read beside a fenced trace takes the set.
 */
export type TenantSql = {
  /** The predicate on trace_summaries. */
  readonly traces: string;
  /** The predicate on stored_spans or evaluation_runs, joined or filtered by trace. */
  readonly sideTable: string;
};

export const FENCED_TENANT_SQL: TenantSql = {
  traces: tenantScope("OccurredAt"),
  sideTable: tenantSet(),
};

const OWN_TENANT_PREDICATE = "TenantId = {tenantId:String}";

export const OWN_TENANT_SQL: TenantSql = {
  traces: OWN_TENANT_PREDICATE,
  sideTable: OWN_TENANT_PREDICATE,
};
