import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import type { TopicModelData } from "../../eventing/topic-model.projection.ts";

/** The memory twin of `PrismaTopicModelProjectionRepository`. */
export class MemoryTopicModelProjectionRepository implements StateProjectionStore<TopicModelData> {
  static create(): MemoryTopicModelProjectionRepository {
    return new MemoryTopicModelProjectionRepository();
  }

  readonly #rows = new Map<string, StoredProjection<TopicModelData>>();

  private constructor() {}

  async get(
    _projectionKey: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<TopicModelData>> {
    const projection = this.#rows.get(String(context.tenantId));
    return projection ? { kind: "folded", projection } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<TopicModelData>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    this.#rows.set(String(context.tenantId), projection);
  }
}
