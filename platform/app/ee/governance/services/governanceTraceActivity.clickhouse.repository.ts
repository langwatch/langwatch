// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * GovernanceTraceActivityClickHouseRepository — governance-domain reads over
 * the shared `trace_summaries` table.
 *
 * `trace_summaries` is not a governance-owned table (the trace pipeline
 * writes it for every project), but several governance surfaces read it
 * filtered down to governance-origin traffic — spans the trace-attribute-
 * accumulation projection stamped with `langwatch.origin.kind =
 * "ingestion_source"` (see governanceAttributeKeys.ts). Those reads live
 * here rather than in the trace-summary repository so the trace pipeline's
 * repository stays free of governance-specific filtering knowledge.
 *
 * Consumers:
 *   - GovernanceSetupStateService — "any governance activity in 30d" probe
 *     for the persona-detection signal
 *   - QuarantineFillEvaluator — per-source span-rate breakdown for the
 *     quarantine-fill Alert
 */
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import {
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
} from "./governanceAttributeKeys";

export class GovernanceTraceActivityClickHouseRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  /**
   * True iff any governance-origin span landed for the tenant on or after
   * `sinceMs`.
   */
  async hasRecentActivity(input: {
    tenantId: string;
    sinceMs: number;
  }): Promise<boolean> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT 1 AS hit
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({since:UInt64})
          AND ts.Attributes[{originKey:String}] = {originValue:String}
        LIMIT 1
      `,
      query_params: {
        tenantId: input.tenantId,
        since: input.sinceMs,
        originKey: GOVERNANCE_ATTR.ORIGIN_KIND,
        originValue: GOVERNANCE_ORIGIN_KIND_VALUE,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{ hit: number }>;
    return rows.length > 0;
  }

  /**
   * Per-IngestionSource span counts for governance-origin traffic landed on
   * or after `sinceMs`, ordered highest-volume first. Rows whose source
   * attribute is missing (empty string) are still returned — callers that
   * want to drop them (e.g. an admin per-source breakdown) filter them out
   * themselves, same as the pre-repository behaviour.
   */
  async findSpanCountsBySource(input: {
    tenantId: string;
    sinceMs: number;
  }): Promise<Array<{ sourceId: string; spanCount: number }>> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          ts.Attributes[{sourceIdKey:String}] AS sourceId,
          count() AS spanCount
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({since:UInt64})
          AND ts.Attributes[{originKey:String}] = {originValue:String}
        GROUP BY sourceId
        ORDER BY spanCount DESC
      `,
      query_params: {
        tenantId: input.tenantId,
        since: input.sinceMs,
        originKey: GOVERNANCE_ATTR.ORIGIN_KIND,
        originValue: GOVERNANCE_ORIGIN_KIND_VALUE,
        sourceIdKey: GOVERNANCE_ATTR.INGESTION_SOURCE_ID,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      sourceId: string;
      spanCount: number | string;
    }>;
    return rows.map((r) => ({
      sourceId: r.sourceId,
      spanCount: Number(r.spanCount ?? 0),
    }));
  }
}
