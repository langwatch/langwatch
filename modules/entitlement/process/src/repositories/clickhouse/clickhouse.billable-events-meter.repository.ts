import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import { Temporal, toDate, toEpochMs } from "@langwatch/time";

import {
  BillableEventsMeterRepository,
  type BillableEventRecord,
  type DayMeterCount,
  type MeterWindow,
  type ProjectMeterCount,
} from "../billable-events-meter.repository.ts";
import { billableEvents } from "./clickhouse.billable-events.table.ts";

/** Inserts as written; every read is built and sent on the reader over a project set (ADR-202). */
type MeterClickHouse = Pick<ClickHouseQueryClient, "insert" | "read">;

/** ClickHouse twin of the meter, moved from billing under the same table and row shape. */
export class BillableEventsMeterClickHouseRepository extends BillableEventsMeterRepository {
  readonly #clickhouse: MeterClickHouse;

  private constructor(clickhouse: MeterClickHouse) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: MeterClickHouse): BillableEventsMeterClickHouseRepository {
    return new BillableEventsMeterClickHouseRepository(clickhouse);
  }

  async insert({
    record,
    organizationId,
  }: {
    record: BillableEventRecord;
    organizationId: string;
  }): Promise<void> {
    await this.#clickhouse.insert({
      tenantId: record.tenantId,
      organizationId,
      table: billableEvents.$table.name,
      rows: [
        {
          OrganizationId: organizationId,
          TenantId: record.tenantId,
          EventId: record.eventId,
          EventType: record.eventType,
          DeduplicationKey: record.deduplicationKey,
          EventTimestamp: toDate(
            Temporal.Instant.fromEpochMilliseconds(toEpochMs(record.eventTimestamp)),
          ),
        },
      ],
      // Async deduplication off, as the pinned server profile has it: the meter counts distinct
      // deduplication keys, so a repeat never counts twice, and the insert may share a statement
      // with others waiting for a slot (ADR-187).
      settings: { async_insert: 1, wait_for_async_insert: 1, async_insert_deduplicate: 0 },
    });
  }

  /** The window's distinct keys over the organization's projects, counted as one set. */
  async findTotal({
    organizationId,
    projectIds,
    startDate,
    endDate,
  }: { organizationId: string; projectIds: readonly string[] } & MeterWindow): Promise<number> {
    if (projectIds.length === 0) return 0;
    const statement = organizationWindow({
      organizationId,
      projectIds,
      window: { startDate, endDate },
    })
      .select({ total: fn.countDistinct(billableEvents.DeduplicationKeyHash) })
      .build();
    const result = await this.#clickhouse.read({ statement });
    return numberOf(result.rows[0]?.total);
  }

  /** Billing's former `findByProjectApprox`, kept `uniq` so enforcement's numbers do not move. */
  async countByProjects(input: {
    organizationId: string;
    projectIds: readonly string[];
    window: MeterWindow;
  }): Promise<ProjectMeterCount[]> {
    if (input.projectIds.length === 0) return [];
    const statement = organizationWindow(input)
      .select({
        projectId: billableEvents.TenantId,
        total: fn.uniq(billableEvents.DeduplicationKeyHash),
      })
      .groupBy(billableEvents.TenantId)
      .build();
    const result = await this.#clickhouse.read({ statement });
    return result.rows.map((row) => ({ projectId: row.projectId, count: numberOf(row.total) }));
  }

  /** Counted `uniq` per day, as `countByProjects` counts per project, so the two agree. */
  async countByDay(input: {
    organizationId: string;
    projectIds: readonly string[];
    window: MeterWindow;
  }): Promise<DayMeterCount[]> {
    if (input.projectIds.length === 0) return [];
    const day = fn.toString(
      fn.toDate(fn.toStartOfDay(billableEvents.EventTimestamp, { timeZone: "UTC" })),
    );
    const statement = organizationWindow(input)
      .select({ day, total: fn.uniq(billableEvents.DeduplicationKeyHash) })
      .groupBy(day)
      .orderBy("day")
      .build();
    const result = await this.#clickhouse.read({ statement });
    return result.rows.map((row) => ({ day: row.day, count: numberOf(row.total) }));
  }
}

/** The organization's rows in a `[start, end)` UTC window, read over its named projects. */
function organizationWindow({
  organizationId,
  projectIds,
  window,
}: {
  organizationId: string;
  projectIds: readonly string[];
  window: MeterWindow;
}) {
  return clickhouseRead({ scope: tenantScope.set({ tenantIds: projectIds }) })
    .from(billableEvents)
    .where(({ and, eq, gte, lt }) =>
      and(
        eq(billableEvents.OrganizationId, organizationId),
        gte(billableEvents.EventTimestamp, epochMsOf(window.startDate)),
        lt(billableEvents.EventTimestamp, epochMsOf(window.endDate)),
      ),
    );
}

/** A window bound written as a UTC `DateTime64(3)` literal, as epoch ms. */
function epochMsOf(timestamp: string): number {
  return Temporal.Instant.from(`${timestamp.replace(" ", "T")}Z`).epochMilliseconds;
}

function numberOf(value: string | number | undefined): number {
  return typeof value === "number" ? value : Number.parseInt(value ?? "0", 10);
}
