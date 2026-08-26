// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import {
  AnomalySpendReaderPort,
  type AnomalySpendSourceFilter,
} from "@langwatch/enterprise-governance-server";
/**
 * GovernanceKpisClickHouseRepository — reads and writes the
 * `governance_kpis` fold projection.
 *
 * Writes: `insertContribution` inserts ONE row keyed by (TenantId,
 * SourceId, HourBucket, TraceId) so subscriber replays of the same trace
 * collapse at merge time.
 *
 * Reads: `findSpendTotals` serves the spend-spike anomaly evaluator's
 * current/baseline window comparison. ActivityMonitorService's own
 * `sum(SpendUsd)` / `count(DISTINCT TraceId)` aggregation (with the IN-
 * tuple dedup pattern for pre-merge state) is a separate, more involved
 * read and stays in that service for now.
 *
 * Spec: specs/ai-gateway/governance/folds.feature
 * Migration: 00021_create_governance_kpis.sql
 */
import type { GovernanceClickHouseClientResolver } from "./clickhouse-client.port";

const TABLE_NAME = "governance_kpis" as const;

const logger = createLogger("langwatch:governance:governance-kpis-clickhouse-repository");

export interface GovernanceKpiContribution {
  tenantId: string;
  sourceId: string;
  sourceType: string;
  hourBucket: Date;
  traceId: string;
  spendUsd: number;
  promptTokens: number;
  completionTokens: number;
  lastEventOccurredAt: Date;
}

export class AppGovernanceKpisAdapter extends AnomalySpendReaderPort {
  constructor(private readonly resolveClient: GovernanceClickHouseClientResolver) {
    super();
  }

  async insertContribution(row: GovernanceKpiContribution): Promise<void> {
    if (!row.tenantId || !row.sourceId || !row.traceId) {
      throw new Error(
        "AppGovernanceKpisAdapter.insertContribution: tenantId / sourceId / traceId are required",
      );
    }
    try {
      const client = await this.resolveClient(row.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [
          {
            TenantId: row.tenantId,
            SourceId: row.sourceId,
            SourceType: row.sourceType,
            HourBucket: row.hourBucket,
            TraceId: row.traceId,
            SpendUsd: row.spendUsd,
            PromptTokens: row.promptTokens,
            CompletionTokens: row.completionTokens,
            LastEventOccurredAt: row.lastEventOccurredAt,
          },
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        {
          tenantId: row.tenantId,
          sourceId: row.sourceId,
          traceId: row.traceId,
          error: errorMessage,
        },
        "Failed to insert governance_kpis contribution",
      );
      throw error;
    }
  }

  /**
   * Current-window and baseline-window spend totals from `governance_kpis`,
   * for the spend-spike anomaly evaluator. `sourceFilter` narrows to a
   * single SourceId / SourceType when the rule is scoped that way; org/
   * team/project-scoped rules pass an empty filter since the TenantId
   * predicate (the org's hidden Gov Project) already covers the whole
   * tenant.
   */
  async findSpendTotals(input: {
    tenantId: string;
    windowStart: Date;
    windowEnd: Date;
    baselineStart: Date;
    sourceFilter: AnomalySpendSourceFilter;
  }): Promise<{ currentSpend: number; baselineSpend: number }> {
    const client = await this.resolveClient(input.tenantId);
    const sourceFilter = toClickHouseSourceFilter(input.sourceFilter);
    const result = await client.query({
      query: `
        SELECT
          sumIf(SpendUsd, HourBucket >= fromUnixTimestamp64Milli({windowStartMs:UInt64})) AS currentSpend,
          sumIf(SpendUsd, HourBucket < fromUnixTimestamp64Milli({windowStartMs:UInt64}) AND HourBucket >= fromUnixTimestamp64Milli({baselineStartMs:UInt64})) AS baselineSpend
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND HourBucket >= fromUnixTimestamp64Milli({baselineStartMs:UInt64})
          AND HourBucket < fromUnixTimestamp64Milli({windowEndMs:UInt64})
          ${sourceFilter.sql}
      `,
      query_params: {
        tenantId: input.tenantId,
        windowStartMs: input.windowStart.getTime(),
        windowEndMs: input.windowEnd.getTime(),
        baselineStartMs: input.baselineStart.getTime(),
        ...sourceFilter.params,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      currentSpend: number | string | null;
      baselineSpend: number | string | null;
    }>;
    const row = rows[0];
    return {
      currentSpend: Number(row?.currentSpend ?? 0),
      baselineSpend: Number(row?.baselineSpend ?? 0),
    };
  }
}

function toClickHouseSourceFilter(filter: AnomalySpendSourceFilter): {
  sql: string;
  params: Record<string, string>;
} {
  if (filter.type === "source") {
    return {
      sql: "AND SourceId = {sourceId:String}",
      params: { sourceId: filter.id },
    };
  }
  if (filter.type === "source_type") {
    return {
      sql: "AND SourceType = {sourceType:String}",
      params: { sourceType: filter.id },
    };
  }
  return { sql: "", params: {} };
}
