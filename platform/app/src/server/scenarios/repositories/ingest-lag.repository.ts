/**
 * IngestLagRepository - the ClickHouse read behind the trace wait budget.
 *
 * Measures, per trace of the last 7 days, how long after its last span ended
 * its span set finished arriving in `stored_spans` (the store the trace API
 * reads), and returns the p95 of that lag plus the sample count. The formula
 * and its clamps live in `../execution/ingest-lag.service.ts`; this module
 * only owns the query, so ClickHouse stays behind the repository boundary.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";

/** Resolves the ClickHouse client for a project. Injectable for tests. */
export type IngestLagClientResolver = (
  projectId: string,
) => Promise<ClickHouseClient | null>;

export interface IngestLagSample {
  p95LagMs: number;
  sampleCount: number;
}

interface IngestLagRow {
  P95LagMs: number | null;
  SampleCount: number | string;
}

/**
 * The project's per-trace ingest lag p95 over the last 7 days, or null when
 * no ClickHouse client is configured or the measurement is unusable.
 */
export async function findIngestLagP95({
  projectId,
  clientResolver = getClickHouseClientForProject,
}: {
  projectId: string;
  clientResolver?: IngestLagClientResolver;
}): Promise<IngestLagSample | null> {
  const client = await clientResolver(projectId);
  if (!client) {
    return null;
  }

  const result = await client.query({
    query: `
      SELECT
        quantile(0.95)(SpanLagMs) AS P95LagMs,
        count() AS SampleCount
      FROM (
        SELECT
          TraceId,
          dateDiff('millisecond', max(EndTime), max(CreatedAt)) AS SpanLagMs
        FROM stored_spans
        WHERE TenantId = {tenantId:String}
          AND StartTime >= now() - INTERVAL 7 DAY
        GROUP BY TraceId
      )
      WHERE SpanLagMs >= 0
    `,
    query_params: { tenantId: projectId },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as IngestLagRow[];

  const row = rows[0];
  const sampleCount = Number(row?.SampleCount ?? 0);
  const p95LagMs = Number(row?.P95LagMs ?? Number.NaN);
  if (!Number.isFinite(p95LagMs)) {
    return null;
  }
  return { p95LagMs, sampleCount };
}
