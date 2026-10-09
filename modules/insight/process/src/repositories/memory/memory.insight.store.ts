import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import type { InsightState } from "../../eventing/insight.projection.ts";
import { InsightMemoryStore } from "./insight-memory.store.ts";

/** The memory twin of `PrismaInsightProjectionStore`. */
export class MemoryInsightProjectionStore implements StateProjectionStore<InsightState> {
  private constructor(private readonly rows: InsightMemoryStore) {}

  static create({ rows }: { rows: InsightMemoryStore }): MemoryInsightProjectionStore {
    return new MemoryInsightProjectionStore(rows);
  }

  async get(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<InsightState>> {
    const projection = this.rows.insights.get(
      InsightMemoryStore.insightKey({ projectId: String(context.tenantId), insightId: key }),
    );
    return projection ? { kind: "folded", projection } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<InsightState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    this.rows.insights.set(
      InsightMemoryStore.insightKey({
        projectId: String(context.tenantId),
        insightId: context.key ?? context.aggregateId,
      }),
      projection,
    );
  }
}
