import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import type { InsightRunInFlightState } from "../../eventing/insight-run-in-flight.projection.ts";
import { InsightMemoryStore } from "./insight-memory.store.ts";

/** The memory twin of `PrismaInsightRunInFlightProjectionRepository`. */
export class MemoryInsightRunInFlightProjectionRepository implements StateProjectionStore<InsightRunInFlightState> {
  private constructor(private readonly rows: InsightMemoryStore) {}

  static create({
    rows,
  }: {
    rows: InsightMemoryStore;
  }): MemoryInsightRunInFlightProjectionRepository {
    return new MemoryInsightRunInFlightProjectionRepository(rows);
  }

  async get(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<InsightRunInFlightState>> {
    const projection = this.rows.runsInFlight.get(
      InsightMemoryStore.scheduleKey({ projectId: String(context.tenantId), scheduleId: key }),
    );
    return projection ? { kind: "folded", projection } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<InsightRunInFlightState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    this.rows.runsInFlight.set(
      InsightMemoryStore.scheduleKey({
        projectId: String(context.tenantId),
        scheduleId: context.key ?? context.aggregateId,
      }),
      projection,
    );
  }
}
