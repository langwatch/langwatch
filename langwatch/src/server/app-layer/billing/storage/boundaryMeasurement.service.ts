import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { TABLE_TTL_CONFIG } from "~/server/clickhouse/ttlReconciler";
import {
  RETENTION_TABLE_CATEGORY_MAP,
  type RetentionCategory,
} from "~/server/data-retention/retentionPolicy.schema";
import {
  BILLABLE_STORAGE_TABLES,
  type BillableStorageTable,
} from "./billableTables";
import { BILLABLE_AFTER_DAYS } from "./boundaryCalendar";
import type { StorageBoundaryEventRepository } from "./repositories/storage-boundary-event.repository";
import {
  floorToDay,
  MS_PER_DAY,
  partitionKeyFor,
  partitionStartFor,
} from "./sealedHour";

/**
 * Mandatory caps on every `_size_bytes` query — `_size_bytes` aggregation at
 * higher parallelism caused two production OOM incidents. The values mirror
 * storageMeter.service.ts; the bounded single-partition shape here is what
 * makes them sufficient.
 */
export const BOUNDARY_QUERY_SETTINGS = {
  max_threads: 2,
  max_execution_time: 45,
} as const;

/**
 * The partition-aligned retention-age expression per billable table, derived
 * from the same config the TTL reconciler deletes on (`retentionTTLColumn`) —
 * the billability axis IS the retention axis by definition. Every billable
 * table's retention column equals its partition column (verified against the
 * ClickHouse DDL), which is what lets the range predicate below prune to a
 * single partition.
 */
const AGE_EXPRESSION_BY_TABLE: Record<BillableStorageTable, string> =
  Object.fromEntries(
    BILLABLE_STORAGE_TABLES.map((table) => {
      const entry = TABLE_TTL_CONFIG.find((config) => config.table === table);
      if (!entry?.retentionTTLColumn) {
        throw new Error(
          `Billable table ${table} has no retentionTTLColumn in TABLE_TTL_CONFIG — ` +
            `it cannot be measured for storage billing`,
        );
      }
      return [
        table,
        entry.retentionTTLColumnExpression ?? entry.retentionTTLColumn,
      ];
    }),
  ) as Record<BillableStorageTable, string>;

interface MeasuredGroup {
  category: RetentionCategory;
  retentionDays: number;
  bytes: bigint;
}

export interface BoundaryMeasurementDeps {
  resolveClickHouseClient: ClickHouseClientResolver | null;
  events: StorageBoundaryEventRepository;
  /** ALL of the org's project ids, archived included — archived data still occupies storage. */
  listProjectIds: (params: { organizationId: string }) => Promise<string[]>;
}

/**
 * The entry edge (ADR-039 Decision 3): while a week-partition is in transit
 * across the 35-day billable line, one bounded single-partition query per
 * table per day computes the newly-billable slice, grouped by
 * `_retention_days`. The emitted delta is cumulative-minus-prior — measured
 * total minus the net of already-recorded non-exit events — so missed days
 * self-heal and re-runs emit nothing.
 *
 * Each day measures the partition containing `day(cutoff)` AND the previous
 * day's partition when it differs (the first sweep after a partition
 * completes its transit catches the final day's tail hours): ≤ 8 bounded
 * queries per partition lifetime, exactly the ADR budget.
 */
export class BoundaryMeasurementService {
  constructor(private readonly deps: BoundaryMeasurementDeps) {}

  async measureEntriesForOrg({
    organizationId,
    at,
  }: {
    organizationId: string;
    at: Date;
  }): Promise<void> {
    if (!this.deps.resolveClickHouseClient) return;

    const cutoff = new Date(at.getTime() - BILLABLE_AFTER_DAYS * MS_PER_DAY);
    const cutoffDay = floorToDay(cutoff);
    const previousDay = new Date(cutoffDay.getTime() - MS_PER_DAY);

    const partitionStarts = [partitionStartFor(cutoffDay)];
    const previousPartitionStart = partitionStartFor(previousDay);
    if (previousPartitionStart.getTime() !== partitionStarts[0]!.getTime()) {
      partitionStarts.push(previousPartitionStart);
    }

    const projectIds = await this.deps.listProjectIds({ organizationId });

    for (const projectId of projectIds) {
      for (const partitionStart of partitionStarts) {
        await this.measurePartition({
          organizationId,
          projectId,
          partitionStart,
          cutoff,
          cutoffDay,
        });
      }
    }
  }

  private async measurePartition({
    organizationId,
    projectId,
    partitionStart,
    cutoff,
    cutoffDay,
  }: {
    organizationId: string;
    projectId: string;
    partitionStart: Date;
    cutoff: Date;
    cutoffDay: Date;
  }): Promise<void> {
    const partitionKey = partitionKeyFor(partitionStart);
    const partitionEnd = new Date(partitionStart.getTime() + 7 * MS_PER_DAY);
    // The slice this delta is attributed to: the day being crossed, clamped
    // into the partition (the final-pass query for last week's partition
    // attributes its tail to that partition's Saturday).
    const partitionLastDay = new Date(partitionEnd.getTime() - MS_PER_DAY);
    const sliceDate = new Date(
      Math.min(cutoffDay.getTime(), partitionLastDay.getTime()),
    );

    const measured = await this.measureBillableBytes({
      projectId,
      partitionStart,
      partitionEnd,
      cutoff,
    });

    const prior = await this.deps.events.sumNonExitByPartition({
      organizationId,
      projectId,
      partitionKey,
    });
    const priorByGroup = new Map(
      prior.map((row) => [
        `${row.category}:${row.retentionDays}`,
        row.totalBytes,
      ]),
    );

    for (const group of measured) {
      // Retention at or under the billable window never bills: those rows die
      // before day 35 (any still-visible ones are past their entitlement).
      // Retention 0 (indefinite) IS billable.
      if (
        group.retentionDays !== 0 &&
        group.retentionDays <= BILLABLE_AFTER_DAYS
      )
        continue;

      const key = `${group.category}:${group.retentionDays}`;
      const priorBytes = priorByGroup.get(key) ?? 0n;
      const deltaBytes = group.bytes - priorBytes;
      if (deltaBytes === 0n) continue;

      await this.deps.events.append({
        organizationId,
        projectId,
        category: group.category,
        partitionKey,
        sliceDate,
        retentionDays: group.retentionDays,
        edge: "ENTRY",
        deltaBytes,
        occurredAt: new Date(
          sliceDate.getTime() + BILLABLE_AFTER_DAYS * MS_PER_DAY,
        ),
      });
    }
  }

  /**
   * One bounded query per billable table, all constrained to a single week
   * partition via a range predicate on the partition-aligned retention
   * column; results are summed per category BEFORE emit (query unit = table,
   * emit unit = category — ADR-039 F7).
   */
  private async measureBillableBytes({
    projectId,
    partitionStart,
    partitionEnd,
    cutoff,
  }: {
    projectId: string;
    partitionStart: Date;
    partitionEnd: Date;
    cutoff: Date;
  }): Promise<MeasuredGroup[]> {
    const client = await this.deps.resolveClickHouseClient!(projectId);
    const byGroup = new Map<string, MeasuredGroup>();

    for (const table of BILLABLE_STORAGE_TABLES) {
      const ageExpr = AGE_EXPRESSION_BY_TABLE[table];
      const category = RETENTION_TABLE_CATEGORY_MAP[table];

      const result = await client.query({
        query: `
          SELECT _retention_days AS retentionDays, toString(sum(_size_bytes)) AS bytes
          FROM ${table}
          WHERE TenantId = {tenantId:String}
            AND ${ageExpr} >= {partitionStart:DateTime64(3)}
            AND ${ageExpr} < {partitionEnd:DateTime64(3)}
            AND ${ageExpr} <= {cutoff:DateTime64(3)}
          GROUP BY _retention_days
        `,
        query_params: {
          tenantId: projectId,
          partitionStart,
          partitionEnd,
          cutoff,
        },
        format: "JSONEachRow",
        clickhouse_settings: BOUNDARY_QUERY_SETTINGS,
      });
      const rows = await result.json<{
        retentionDays: number;
        bytes: string;
      }>();

      for (const row of rows) {
        const key = `${category}:${row.retentionDays}`;
        const existing = byGroup.get(key);
        const bytes = BigInt(row.bytes);
        if (existing) {
          existing.bytes += bytes;
        } else {
          byGroup.set(key, {
            category,
            retentionDays: Number(row.retentionDays),
            bytes,
          });
        }
      }
    }

    return [...byGroup.values()];
  }
}
