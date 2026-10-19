import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import type { InsightDailyScheduleState } from "../../eventing/insight-daily-schedule.projection.ts";
import { InsightMemoryStore } from "./insight-memory.store.ts";

/** The memory twin of `PrismaInsightDailyScheduleProjectionRepository`. */
export class MemoryInsightDailyScheduleProjectionRepository implements StateProjectionStore<InsightDailyScheduleState> {
  private constructor(private readonly rows: InsightMemoryStore) {}

  static create({
    rows,
  }: {
    rows: InsightMemoryStore;
  }): MemoryInsightDailyScheduleProjectionRepository {
    return new MemoryInsightDailyScheduleProjectionRepository(rows);
  }

  async get(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<InsightDailyScheduleState>> {
    const projection = this.rows.schedules.get(
      InsightMemoryStore.scheduleKey({ projectId: String(context.tenantId), scheduleId: key }),
    );
    return projection ? { kind: "folded", projection } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<InsightDailyScheduleState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    this.rows.schedules.set(
      InsightMemoryStore.scheduleKey({
        projectId: String(context.tenantId),
        scheduleId: context.key ?? context.aggregateId,
      }),
      projection,
    );
  }
}
