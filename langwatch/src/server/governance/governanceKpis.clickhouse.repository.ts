/**
 * GovernanceKpisClickHouseRepository — write side of the
 * `governance_kpis` fold projection. Each call inserts ONE row keyed
 * by (TenantId, SourceId, HourBucket, TraceId) so reactor replays of
 * the same trace collapse at merge time.
 *
 * Read side lives in ActivityMonitorService.summary() (and 3e anomaly
 * reactor) which aggregate via `sum(SpendUsd)` / `count(DISTINCT
 * TraceId)` over the (SourceId, HourBucket) group with the standard
 * IN-tuple dedup pattern when pre-merge state matters.
 *
 * Spec: specs/ai-gateway/governance/folds.feature
 * Migration: 00021_create_governance_kpis.sql
 */
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";

const TABLE_NAME = "governance_kpis" as const;

const logger = createLogger(
  "langwatch:governance:governance-kpis-clickhouse-repository",
);

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

export class GovernanceKpisClickHouseRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insertContribution(row: GovernanceKpiContribution): Promise<void> {
    if (!row.tenantId || !row.sourceId || !row.traceId) {
      throw new Error(
        "GovernanceKpisClickHouseRepository.insertContribution: tenantId / sourceId / traceId are required",
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
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
}
