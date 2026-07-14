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
 * Most partitions one entry catch-up may cover (~2 months of missed sweep
 * days). A gap beyond this is re-seed-runbook territory, not a silent
 * self-heal.
 */
export const MAX_CATCHUP_PARTITIONS = 9;

/**
 * The partition-aligned retention-age expression per billable table, derived
 * from the same config the TTL reconciler deletes on (`retentionTTLColumn`) —
 * the billability axis IS the retention axis by definition. Every billable
 * table's retention column equals its partition column (verified against the
 * ClickHouse DDL), which is what lets the range predicate below prune to a
 * single partition.
 */
export const AGE_EXPRESSION_BY_TABLE: Record<BillableStorageTable, string> =
  Object.fromEntries(
    BILLABLE_STORAGE_TABLES.map((table) => {
      const entry = TABLE_TTL_CONFIG.find((config) => config.table === table);
      if (!entry?.retentionTTLColumn) {
        throw new Error(
          `Billable table ${table} has no retentionTTLColumn in TABLE_TTL_CONFIG — ` +
            `it cannot be measured for storage billing`,
        );
      }
      // event_log's TTL expression uses toDateTime(...), but its PARTITION
      // expression is toYearWeek(toDateTime64(EventOccurredAt / 1000, 3)) —
      // the predicate must structurally match the partition's inner
      // expression or ClickHouse cannot prune, and an unpruned event_log
      // scan is exactly the OOM shape this design eliminates. Verified per
      // table against system.tables by the partition-alignment test.
      const expression =
        table === "event_log"
          ? "toDateTime64(EventOccurredAt / 1000, 3)"
          : (entry.retentionTTLColumnExpression ?? entry.retentionTTLColumn);
      return [table, expression];
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
  /**
   * True while a retroactive `_retention_days` mutation is in flight for the
   * project. During that window ClickHouse still carries the OLD retention
   * label while the event log has already re-booked the bytes under the new
   * one (reverse-then-emit) — so measuring would re-add a phantom old-group
   * ENTRY (measured old bytes minus a reversed-to-zero prior) and over-count
   * the gauge until the old group's exit. Skipping the project until the
   * mutation lands avoids that (customer-favorable: under, never over).
   *
   * Recovery of the skipped days: the measurement query is cumulative over
   * a whole partition, so any later slice of the same partition measured
   * after the mutation lands catches the skipped bytes back up. The one
   * gap is a partition on its FINAL transit day skipped for the entire
   * in-flight window — no later slice re-measures it, so it is recovered by
   * the phase-3 reference audit (which keeps in-flight-mutation orgs on the
   * daily tier), not by measurement. Optional — when absent, no project is
   * skipped.
   */
  hasInFlightRetentionMutation?: (params: {
    projectId: string;
  }) => Promise<boolean>;
}

/**
 * The entry edge (ADR-039 Decision 3): while a week-partition is in transit
 * across the 35-day billable line, one bounded single-partition query per
 * table per day computes the newly-billable slice, grouped by
 * `_retention_days`. The emitted delta is cumulative-minus-prior — measured
 * total minus the net of already-recorded non-exit events — so missed days
 * self-heal and re-runs emit nothing.
 *
 * The cutoff is capped to a WHOLE-DAY boundary: on day D the measurement
 * covers slices complete through day(at − 35d), so each day-slice is
 * measured exactly once, completely, on the first sweep after it fully
 * crosses — never split across two measurements with the same identity
 * (which the dedup key would collapse, silently dropping the second part).
 * A slice therefore enters the bill up to ~1 day late — inside the ADR's
 * stated ~1-day, customer-favorable accuracy — and 7 bounded queries cover
 * a partition's lifetime with no special final pass.
 */
export class BoundaryMeasurementService {
  constructor(private readonly deps: BoundaryMeasurementDeps) {}

  async measureEntriesForOrg({
    organizationId,
    at,
    sinceDay,
  }: {
    organizationId: string;
    at: Date;
    /**
     * The previous entry-sweep day (from the day cursor). Bounds the
     * catch-up: every slice completed since then gets its partition
     * measured, so an outage crossing a partition boundary can't strand the
     * old partition's tail. Null/omitted = current slice only.
     */
    sinceDay?: Date | null;
  }): Promise<void> {
    if (!this.deps.resolveClickHouseClient) return;

    // Whole-day cutoff: slices strictly before this instant are complete.
    const cutoff = floorToDay(
      new Date(at.getTime() - BILLABLE_AFTER_DAYS * MS_PER_DAY),
    );
    // The newest fully-crossed slice — what a measurement attributes its
    // delta to (clamped into each measured partition).
    const sliceDate = new Date(cutoff.getTime() - MS_PER_DAY);

    // Partitions to measure: the current slice's, plus every partition a
    // missed slice falls into (cumulative-minus-prior self-heals WITHIN a
    // partition, but only if that partition is queried at all). Capped at
    // the catch-up ceiling — beyond it, the re-seed runbook owns recovery.
    const oldestMissedSlice = sinceDay
      ? floorToDay(
          new Date(sinceDay.getTime() - BILLABLE_AFTER_DAYS * MS_PER_DAY),
        )
      : sliceDate;
    const partitionStarts: Date[] = [];
    for (
      let dayMs = Math.max(
        oldestMissedSlice.getTime(),
        sliceDate.getTime() - (MAX_CATCHUP_PARTITIONS - 1) * 7 * MS_PER_DAY,
      );
      dayMs <= sliceDate.getTime();
      dayMs += MS_PER_DAY
    ) {
      const start = partitionStartFor(new Date(dayMs));
      if (
        partitionStarts.length === 0 ||
        partitionStarts[partitionStarts.length - 1]!.getTime() !==
          start.getTime()
      ) {
        partitionStarts.push(start);
      }
    }

    const projectIds = await this.deps.listProjectIds({ organizationId });

    for (const projectId of projectIds) {
      // Reverse-then-emit hazard: while a retention mutation is in flight,
      // ClickHouse still carries the old retention label but the event log
      // already re-booked those bytes under the new one. Measuring now would
      // re-add a phantom old-group ENTRY (over-count). Skip the project until
      // the mutation lands; cumulative-minus-prior catches it up next run.
      if (
        this.deps.hasInFlightRetentionMutation &&
        (await this.deps.hasInFlightRetentionMutation({ projectId }))
      ) {
        continue;
      }
      for (const partitionStart of partitionStarts) {
        await this.measurePartition({
          organizationId,
          projectId,
          partitionStart,
          cutoff,
          sliceDate,
        });
      }
    }
  }

  private async measurePartition({
    organizationId,
    projectId,
    partitionStart,
    cutoff,
    sliceDate,
  }: {
    organizationId: string;
    projectId: string;
    partitionStart: Date;
    cutoff: Date;
    sliceDate: Date;
  }): Promise<void> {
    const partitionKey = partitionKeyFor(partitionStart);
    const partitionEnd = new Date(partitionStart.getTime() + 7 * MS_PER_DAY);
    // Attribute the delta to the newest completed slice, clamped into this
    // partition (a catch-up pass over an older partition attributes to its
    // Saturday).
    const partitionLastDay = new Date(partitionEnd.getTime() - MS_PER_DAY);
    const attributedSlice = new Date(
      Math.min(sliceDate.getTime(), partitionLastDay.getTime()),
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
        sliceDate: attributedSlice,
        retentionDays: group.retentionDays,
        edge: "ENTRY",
        deltaBytes,
        occurredAt: new Date(
          attributedSlice.getTime() + BILLABLE_AFTER_DAYS * MS_PER_DAY,
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
            AND ${ageExpr} < {cutoff:DateTime64(3)}
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
