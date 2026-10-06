import { Temporal } from "@langwatch/time";

import {
  BillableEventsMeterRepository,
  type BillableEventRecord,
  type MeterWindow,
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
    const start = Temporal.Instant.from(`${input.startDate.replace(" ", "T")}Z`).epochMilliseconds;
    const end = Temporal.Instant.from(`${input.endDate.replace(" ", "T")}Z`).epochMilliseconds;
    const keys = this.rows
      .filter((row) => row.organizationId === input.organizationId)
      .filter((row) => row.eventTimestamp >= start && row.eventTimestamp < end)
      .map((row) => row.deduplicationKey);
    return new Set(keys).size;
  }
}
