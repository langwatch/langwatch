import { Temporal } from "@langwatch/time";

import { TraceCountRepository, type TraceUsageRow } from "../trace-count.repository.ts";

type Row = TraceUsageRow & { organizationId: string };

/** In-memory twin: one row per key, as the table's merge leaves it, read as ClickHouse reads it. */
export class MemoryTraceCountRepository extends TraceCountRepository {
  readonly #rows = new Map<string, Row>();

  protected constructor() {
    super();
  }

  static create(): MemoryTraceCountRepository {
    return new MemoryTraceCountRepository();
  }

  /** Every row written, one per key. */
  get rows(): Row[] {
    return [...this.#rows.values()];
  }

  async insert({
    organizationId,
    rows,
  }: {
    organizationId: string;
    rows: readonly TraceUsageRow[];
  }): Promise<void> {
    for (const row of rows) {
      const key = [organizationId, row.month, row.projectId, row.traceId].join("\u0000");
      this.#rows.set(key, { ...row, organizationId });
    }
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
      projectIds: [...new Set(this.rows.map((row) => row.projectId))],
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
    const firstMonths = new Map<string, Row>();
    for (const row of this.#rows.values()) {
      if (row.organizationId !== organizationId || !named.has(row.projectId)) continue;
      if (row.month !== month && row.month !== previous) continue;
      const key = `${row.projectId}\u0000${row.traceId}`;
      const first = firstMonths.get(key);
      if (first === undefined || row.month < first.month) firstMonths.set(key, row);
    }
    const counts = new Map<string, number>();
    for (const first of firstMonths.values()) {
      if (first.month !== month) continue;
      counts.set(first.projectId, (counts.get(first.projectId) ?? 0) + 1);
    }
    return [...counts].map(([projectId, count]) => ({ projectId, count }));
  }
}
