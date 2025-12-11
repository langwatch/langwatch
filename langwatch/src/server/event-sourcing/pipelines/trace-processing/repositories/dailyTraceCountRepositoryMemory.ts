import type {
  Projection,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import type { DailyTraceCountData } from "../projections/dailyTraceCountProjection";
import type { DailyTraceCountRepository } from "./dailyTraceCountRepository";

/**
 * In-memory repository for daily trace counts.
 * Uses a Map with Sets for unique trace tracking per day per tenant.
 * Useful for testing and development.
 */
export class DailyTraceCountRepositoryMemory<
  ProjectionType extends Projection = Projection,
> implements DailyTraceCountRepository<ProjectionType>
{
  /**
   * Stores unique trace IDs per (tenantId, dateUtc) combination.
   * Key format: `${tenantId}:${dateUtc}`
   */
  private readonly tracesPerDay = new Map<string, Set<string>>();

  private getKey(tenantId: string, dateUtc: string): string {
    return `${tenantId}:${dateUtc}`;
  }

  /**
   * Returns null as daily trace counts are aggregated and not retrieved per trace.
   */
  async getProjection(
    _aggregateId: string,
    _context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null> {
    return null;
  }

  async storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    const data = projection.data as DailyTraceCountData;
    const key = this.getKey(context.tenantId, data.DateUtc);

    let traces = this.tracesPerDay.get(key);
    if (!traces) {
      traces = new Set<string>();
      this.tracesPerDay.set(key, traces);
    }

    traces.add(data.TraceId);
  }

  /**
   * Gets the count of unique traces for a specific tenant and date.
   * Useful for testing.
   */
  getTraceCount(tenantId: string, dateUtc: string): number {
    const key = this.getKey(tenantId, dateUtc);
    const traces = this.tracesPerDay.get(key);
    return traces?.size ?? 0;
  }

  /**
   * Gets all unique trace IDs for a specific tenant and date.
   * Useful for testing.
   */
  getTraceIds(tenantId: string, dateUtc: string): string[] {
    const key = this.getKey(tenantId, dateUtc);
    const traces = this.tracesPerDay.get(key);
    return traces ? Array.from(traces) : [];
  }

  /**
   * Clears all stored data.
   * Useful for testing.
   */
  clear(): void {
    this.tracesPerDay.clear();
  }
}
