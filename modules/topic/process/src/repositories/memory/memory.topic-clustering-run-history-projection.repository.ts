import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import type { TopicClusteringRunHistoryData } from "../../eventing/topic-clustering-run-history.projection.ts";

/** The memory twin of `PrismaTopicClusteringRunHistoryProjectionRepository`. */
export class MemoryTopicClusteringRunHistoryProjectionRepository implements StateProjectionStore<TopicClusteringRunHistoryData> {
  static create(): MemoryTopicClusteringRunHistoryProjectionRepository {
    return new MemoryTopicClusteringRunHistoryProjectionRepository();
  }

  readonly #rows = new Map<string, StoredProjection<TopicClusteringRunHistoryData>>();

  private constructor() {}

  async get(
    _projectionKey: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<TopicClusteringRunHistoryData>> {
    const projection = this.#rows.get(String(context.tenantId));
    return projection ? { kind: "folded", projection } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<TopicClusteringRunHistoryData>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    this.#rows.set(String(context.tenantId), projection);
  }
}
