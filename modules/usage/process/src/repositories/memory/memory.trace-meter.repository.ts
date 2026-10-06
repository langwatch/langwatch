import { Temporal } from "@langwatch/time";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";

import type { BillableEventRecord } from "../billable-events-meter.repository.ts";
import { TraceMeterRepository, type TraceMeterRecord } from "../trace-meter.repository.ts";

/** In-memory twin: deduplicates on read and looks back one month, as the ClickHouse count does. */
export class MemoryTraceMeterRepository extends TraceMeterRepository {
  readonly rows: TraceMeterRecord[] = [];

  /** The billable-events twin's rows the seed folds from; the shared ClickHouse store's twin. */
  protected constructor(private readonly billableEvents: readonly BillableEventRecord[]) {
    super();
  }

  static create({
    billableEvents = [],
  }: { billableEvents?: readonly BillableEventRecord[] } = {}): MemoryTraceMeterRepository {
    return new MemoryTraceMeterRepository(billableEvents);
  }

  async seedMonth({ month, dryRun }: { month: string; dryRun: boolean }): Promise<number> {
    const seeded = new Map<string, TraceMeterRecord>();
    for (const event of this.billableEvents) {
      const [tenantId, traceId, spanId] = event.deduplicationKey.split(":");
      const eventMonth = Temporal.Instant.fromEpochMilliseconds(event.eventTimestamp)
        .toZonedDateTimeISO("UTC")
        .toPlainDate()
        .toPlainYearMonth()
        .toString();
      if (event.eventType !== SPAN_RECEIVED_EVENT_TYPE || eventMonth !== month) continue;
      if (!event.organizationId || !traceId || spanId === undefined) continue;
      if (tenantId !== event.tenantId) continue;
      const record = { organizationId: event.organizationId, tenantId, traceId, month };
      seeded.set(`${event.organizationId}\u0000${tenantId}\u0000${traceId}`, record);
    }
    if (!dryRun) this.rows.push(...seeded.values());
    return seeded.size;
  }

  async insert({
    record,
    organizationId,
  }: {
    record: TraceMeterRecord;
    organizationId: string;
  }): Promise<void> {
    this.rows.push({ ...record, organizationId });
  }

  async findTotal({
    organizationId,
    month,
  }: {
    organizationId: string;
    month: string;
  }): Promise<number> {
    const previous = Temporal.PlainYearMonth.from(month).subtract({ months: 1 }).toString();
    const firstMonths = new Map<string, string>();
    for (const row of this.rows) {
      if (row.organizationId !== organizationId) continue;
      if (row.month !== month && row.month !== previous) continue;
      const key = `${row.tenantId}\u0000${row.traceId}`;
      const first = firstMonths.get(key);
      if (first === undefined || row.month < first) firstMonths.set(key, row.month);
    }
    return [...firstMonths.values()].filter((first) => first === month).length;
  }
}
