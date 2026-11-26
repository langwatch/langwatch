import { Temporal } from "@langwatch/time";

import {
  BillableEventsMeterRepository,
  type BillableEventRecord,
  type DayMeterCount,
  type EventTypeMeterCount,
  type MeterWindow,
  type ProjectMeterCount,
} from "../billable-events-meter.repository.ts";

/** In-memory twin: deduplicates on read, as the ClickHouse count does. */
export class MemoryBillableEventsMeterRepository extends BillableEventsMeterRepository {
  readonly rows: BillableEventRecord[] = [];

  static create(): MemoryBillableEventsMeterRepository {
    return new MemoryBillableEventsMeterRepository();
  }

  async insert({
    record,
    organizationId,
  }: {
    record: BillableEventRecord;
    organizationId: string;
  }): Promise<void> {
    this.rows.push({ ...record, organizationId });
  }

  async findTotal(input: { organizationId: string } & MeterWindow): Promise<number> {
    const keys = this.#inWindow({ organizationId: input.organizationId, window: input }).map(
      (row) => row.deduplicationKey,
    );
    return new Set(keys).size;
  }

  /** Exact where ClickHouse's `uniq` is approximate, so small test data stays deterministic. */
  async countByProjects(input: {
    organizationId: string;
    projectIds: readonly string[];
    window: MeterWindow;
  }): Promise<ProjectMeterCount[]> {
    const keysByProject = new Map<string, Set<string>>();
    for (const row of this.#inWindow(input)) {
      if (!input.projectIds.includes(row.tenantId)) continue;
      const keys = keysByProject.get(row.tenantId) ?? new Set<string>();
      keys.add(row.deduplicationKey);
      keysByProject.set(row.tenantId, keys);
    }
    return [...keysByProject].map(([projectId, keys]) => ({ projectId, count: keys.size }));
  }

  /** Exact per UTC day, as `countByProjects` is exact per project. */
  async countByDay(input: {
    organizationId: string;
    projectIds: readonly string[];
    window: MeterWindow;
  }): Promise<DayMeterCount[]> {
    const keysByDay = new Map<string, Set<string>>();
    for (const row of this.#inWindow(input)) {
      if (!input.projectIds.includes(row.tenantId)) continue;
      const day = Temporal.Instant.fromEpochMilliseconds(row.eventTimestamp)
        .toZonedDateTimeISO("UTC")
        .toPlainDate()
        .toString();
      const keys = keysByDay.get(day) ?? new Set<string>();
      keys.add(row.deduplicationKey);
      keysByDay.set(day, keys);
    }
    return [...keysByDay]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([day, keys]) => ({ day, count: keys.size }));
  }

  /** Exact per event type, as `countByDay` is exact per day. */
  async countByType(input: {
    organizationId: string;
    projectIds: readonly string[];
    window: MeterWindow;
  }): Promise<EventTypeMeterCount[]> {
    const keysByType = new Map<string, Set<string>>();
    for (const row of this.#inWindow(input)) {
      if (!input.projectIds.includes(row.tenantId)) continue;
      const keys = keysByType.get(row.eventType) ?? new Set<string>();
      keys.add(row.deduplicationKey);
      keysByType.set(row.eventType, keys);
    }
    return [...keysByType]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([eventType, keys]) => ({ eventType, count: keys.size }));
  }

  #inWindow(input: { organizationId: string; window: MeterWindow }): BillableEventRecord[] {
    const start = epochMs(input.window.startDate);
    const end = epochMs(input.window.endDate);
    return this.rows
      .filter((row) => row.organizationId === input.organizationId)
      .filter((row) => row.eventTimestamp >= start && row.eventTimestamp < end);
  }
}

function epochMs(timestamp: string): number {
  return Temporal.Instant.from(`${timestamp.replace(" ", "T")}Z`).epochMilliseconds;
}
