// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type ClickHouseClient,
  ch,
  createRowCodec,
  defineTable,
  replacing,
  type TableRow,
} from "@langwatch/clickhouse";
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
 * Migrations: 00031_create_governance_kpis.sql,
 *             00065_governance_kpis_event_grain.sql (EventId + sort key)
 */
import { assertSingleTenantBatch } from "./singleTenantBatch";

const logger = createLogger(
  "langwatch:governance:governance-kpis-clickhouse-repository",
);

/**
 * `HourBucket` is a plain `DateTime`, no ADR-099 time role — `ch.dateTime()`
 * matches the deployed DDL exactly. It anchors the partition anyway: it is
 * part of this row's own sort-key identity, so it never moves once written,
 * even though customer event timing (not the platform) decides its value.
 *
 * `LastEventOccurredAt` is the `ReplacingMergeTree` version but carries the
 * contributing span's own `occurredAt` (migration 00063), not our write
 * clock — its true role is `occurredAt`. Both are registered below as
 * structural debt this table cannot re-key without a migration (ADR-099).
 */
const table = defineTable({
  name: "governance_kpis",
  merge: replacing({ version: "LastEventOccurredAt" }),
  sortKey: ["TenantId", "SourceId", "HourBucket", "TraceId", "EventId"],
  partition: { by: "toYYYYMM(HourBucket)", column: "HourBucket" },
  tenant: ["TenantId"],
  structuralDebt: [
    {
      column: "HourBucket",
      reason:
        "HourBucket is a plain DateTime derived from customer event time and anchors the partition; it is frozen only because it is part of this row's own sort-key identity, not because the platform set it",
    },
    {
      column: "LastEventOccurredAt",
      reason:
        "LastEventOccurredAt is the contributing span's own occurredAt (customer time), not our write clock, but migration 00063's per-span key makes it order two versions of the same row correctly anyway",
    },
  ],
  columns: {
    TenantId: ch.string(),
    SourceId: ch.string(),
    HourBucket: ch.dateTime(),
    TraceId: ch.string(),
    EventId: ch.string(),
    SourceType: ch.lowCardinality(ch.string()),
    SpendUsd: ch.float64(),
    PromptTokens: ch.uint64(),
    CompletionTokens: ch.uint64(),
    CreatedAt: ch.dateTime64(3),
    LastEventOccurredAt: ch.occurredAt(),
  },
});

type Row = TableRow<typeof table.columns>;

const codec = createRowCodec();

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
   * Part of the sorting key since migration 00063, which is what makes a
   * re-derivation collapse onto the row it re-derives instead of adding a
   * second one. Optional so pre-ADR-075 (retired; ground now ADR-098)
   * writers (the retired reactor,
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

/**
 * `LastEventOccurredAt` is the ReplacingMergeTree version despite its
 * registered structural debt: identical on re-derivation of the same span (a
 * content-identical tie is harmless) and strictly later on a genuine
 * re-report (so the newer report wins). `CreatedAt` carries no such
 * contract, so it takes one shared write instant per batch instead of being
 * left to the column's own `DEFAULT now64(3)` — the positional wire form
 * has no way to omit a declared column and fall back to a server default.
 */
function toRow(row: GovernanceKpiContribution, writtenAt: Date): Row {
  return {
    TenantId: row.tenantId,
    SourceId: row.sourceId,
    HourBucket: row.hourBucket,
    TraceId: row.traceId,
    EventId: row.eventId ?? "",
    SourceType: row.sourceType,
    SpendUsd: row.spendUsd,
    PromptTokens: BigInt(Math.round(row.promptTokens)),
    CompletionTokens: BigInt(Math.round(row.completionTokens)),
    CreatedAt: writtenAt,
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
  constructor(
    private readonly resolveClient: (tenantId: string) => ClickHouseClient,
  ) {}

  async insertContribution(row: GovernanceKpiContribution): Promise<void> {
    assertInsertable(row, "insertContribution");
    await this.insertRows([row]);
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
    await this.insertRows(rows);
  }

  private async insertRows(rows: GovernanceKpiContribution[]): Promise<void> {
    const tenantId = assertSingleTenantBatch(
      rows,
      "GovernanceKpisClickHouseRepository",
    );

    const writtenAt = new Date();
    const encodedRows = codec.encodeRows({
      columns: table.wireColumns,
      columnNames: table.columnNames,
      rows: rows.map((row) => toRow(row, writtenAt)),
    });

    try {
      const client = this.resolveClient(tenantId);
      await client.insert({
        tenantId,
        table: table.name,
        rows: encodedRows,
        columns: table.columnNames,
        // Retryable: LastEventOccurredAt is the replacing version, so a
        // redelivered batch collapses at merge instead of duplicating
        // (ADR-104 §2).
        target: { kind: "replacing" },
      });
    } catch (error) {
      logger.error(
        {
          tenantId,
          rowCount: rows.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to insert governance_kpis contribution(s)",
      );
      throw error;
    }
  }
}
