import {
  type PlanLimitRefusalDay,
  TracePlanLimitRefusalsRepository,
} from "../../features/ingestion/repositories/trace-plan-limit-refusals.repository.ts";

/** In-memory twin of trace's Postgres plan-limit refusal counter. */
export class MemoryTracePlanLimitRefusalsRepository extends TracePlanLimitRefusalsRepository {
  private readonly rows = new Map<string, PlanLimitRefusalDay & { refusals: number }>();

  static create(): MemoryTracePlanLimitRefusalsRepository {
    return new MemoryTracePlanLimitRefusalsRepository();
  }

  async recordRefusal({ projectId, dayStartMs }: PlanLimitRefusalDay): Promise<void> {
    const key = `${projectId}:${dayStartMs}`;
    const refusals = (this.rows.get(key)?.refusals ?? 0) + 1;
    this.rows.set(key, { projectId, dayStartMs, refusals });
  }

  async countRefusals({
    projectIds,
    fromDayMs,
    toDayMs,
  }: {
    projectIds: readonly string[];
    fromDayMs: number;
    toDayMs: number;
  }): Promise<ReadonlyMap<string, number>> {
    const totals = new Map<string, number>();
    for (const row of this.rows.values()) {
      if (!projectIds.includes(row.projectId)) continue;
      if (row.dayStartMs < fromDayMs || row.dayStartMs > toDayMs) continue;
      totals.set(row.projectId, (totals.get(row.projectId) ?? 0) + row.refusals);
    }
    return totals;
  }
}
