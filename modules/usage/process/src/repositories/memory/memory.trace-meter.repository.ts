import { Temporal } from "@langwatch/time";

import { TraceMeterRepository, type TraceMeterRecord } from "../trace-meter.repository.ts";

/** In-memory twin: deduplicates on read and looks back one month, as the ClickHouse count does. */
export class MemoryTraceMeterRepository extends TraceMeterRepository {
  readonly rows: TraceMeterRecord[] = [];

  static create(): MemoryTraceMeterRepository {
    return new MemoryTraceMeterRepository();
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
