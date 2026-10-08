import { Temporal } from "@langwatch/time";

import { TraceMeterRepository, type TraceMeterRecord } from "../trace-meter.repository.ts";

/** In-memory twin: deduplicates on read and looks back one month, as the ClickHouse count does. */
export class MemoryTraceMeterRepository extends TraceMeterRepository {
  readonly rows: TraceMeterRecord[] = [];

  protected constructor() {
    super();
  }

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
    const counts = await this.countByProjects({
      organizationId,
      projectIds: [...new Set(this.rows.map((row) => row.tenantId))],
      month,
    });
    return counts.reduce((total, { count }) => total + count, 0);
  }

  async countByProjects({
    organizationId,
    projectIds,
    month,
  }: {
    organizationId: string;
    projectIds: readonly string[];
    month: string;
  }): Promise<{ projectId: string; count: number }[]> {
    const previous = Temporal.PlainYearMonth.from(month).subtract({ months: 1 }).toString();
    const named = new Set(projectIds);
    const firstMonths = new Map<string, { tenantId: string; month: string }>();
    for (const row of this.rows) {
      if (row.organizationId !== organizationId || !named.has(row.tenantId)) continue;
      if (row.month !== month && row.month !== previous) continue;
      const key = `${row.tenantId}\u0000${row.traceId}`;
      const first = firstMonths.get(key);
      if (first === undefined || row.month < first.month) firstMonths.set(key, row);
    }
    const counts = new Map<string, number>();
    for (const first of firstMonths.values()) {
      if (first.month !== month) continue;
      counts.set(first.tenantId, (counts.get(first.tenantId) ?? 0) + 1);
    }
    return [...counts].map(([projectId, count]) => ({ projectId, count }));
  }
}
