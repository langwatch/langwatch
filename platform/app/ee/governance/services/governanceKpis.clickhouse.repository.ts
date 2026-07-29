// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
/**
 * GovernanceKpisClickHouseRepository — write side of the
 * `governance_kpis` map projection. Each call inserts ONE row keyed
 * by (TenantId, SourceId, HourBucket, TraceId, EventId) so re-derivations
 * of the same span collapse at merge time.
 *
 * Read side lives in ActivityMonitorService.summary() (and the
 * spend-spike anomaly evaluator) which aggregate via `sum(SpendUsd)` /
 * `count(DISTINCT TraceId)` over the (SourceId, HourBucket) group with the
 * standard IN-tuple dedup pattern when pre-merge state matters.
 *
 * Spec: specs/ai-gateway/governance/folds.feature
 * Migration: 00021_create_governance_kpis.sql
 */
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { assertSingleTenantBatch } from "./singleTenantBatch";

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
  /**
   * Identity of the SOURCE EVENT this contribution was derived from — the
   * span id (hex) for span-shaped governance ingest.
   *
   * Part of the sorting key since migration 00058, which is what makes a
   * re-derivation collapse onto the row it re-derives instead of adding a
   * second one. Optional so pre-ADR-075 writers (the retired reactor,
   * whose rows are trace-grained) still type-check; those rows carry the
   * column's `''` default and keep deduping among themselves at trace
   * grain. New writers MUST set it.
   */
  eventId?: string;
  spendUsd: number;
  promptTokens: number;
  completionTokens: number;
  lastEventOccurredAt: Date;
}

/** Row shape on the wire; field names match the ClickHouse columns exactly. */
function toRow(row: GovernanceKpiContribution) {
  return {
    TenantId: row.tenantId,
    SourceId: row.sourceId,
    SourceType: row.sourceType,
    HourBucket: row.hourBucket,
    TraceId: row.traceId,
    EventId: row.eventId ?? "",
    SpendUsd: row.spendUsd,
    PromptTokens: row.promptTokens,
    CompletionTokens: row.completionTokens,
    LastEventOccurredAt: row.lastEventOccurredAt,
  };
}

function assertInsertable(
  row: GovernanceKpiContribution,
  method: string,
): void {
  if (!row.tenantId || !row.sourceId || !row.traceId) {
    throw new Error(
      `GovernanceKpisClickHouseRepository.${method}: tenantId / sourceId / traceId are required`,
    );
  }
}

export class GovernanceKpisClickHouseRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insertContribution(row: GovernanceKpiContribution): Promise<void> {
    assertInsertable(row, "insertContribution");
    try {
      const client = await this.resolveClient(row.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [toRow(row)],
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

  /**
   * Batch form of {@link insertContribution}, used by the projection's
   * `bulkAppend` so a replay does not issue one INSERT per span.
   *
   * Single-tenant by contract: the projection executor only batches within
   * one tenant, and a cross-tenant batch would have to pick one client and
   * write another tenant's rows through it. Rejected rather than guessed.
   */
  async insertContributions(rows: GovernanceKpiContribution[]): Promise<void> {
    if (rows.length === 0) return;
    for (const row of rows) assertInsertable(row, "insertContributions");

    const tenantId = assertSingleTenantBatch(
      rows,
      "GovernanceKpisClickHouseRepository.insertContributions",
    );

    try {
      const client = await this.resolveClient(tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: rows.map(toRow),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, rowCount: rows.length, error: errorMessage },
        "Failed to insert governance_kpis contribution batch",
      );
      throw error;
    }
  }
}
