import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import type { TopicClusteringRunStatusData } from "../../eventing/topic-clustering-run-status.projection.ts";

/** The memory twin of `PrismaTopicClusteringRunProjectionRepository`. */
export class MemoryTopicClusteringRunProjectionRepository implements StateProjectionStore<TopicClusteringRunStatusData> {
  static create(): MemoryTopicClusteringRunProjectionRepository {
    return new MemoryTopicClusteringRunProjectionRepository();
  }

  readonly #rows = new Map<string, StoredProjection<TopicClusteringRunStatusData>>();

  private constructor() {}

  async get(
    _projectionKey: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<TopicClusteringRunStatusData>> {
    const projection = this.#rows.get(String(context.tenantId));
    return projection ? { kind: "folded", projection } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<TopicClusteringRunStatusData>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    this.#rows.set(String(context.tenantId), projection);
  }
}
