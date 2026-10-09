import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import type { InsightReaderState } from "../../eventing/insight-reader.projection.ts";
import { parseInsightReaderKey } from "../../rules/insight-reader-key.rules.ts";
import { InsightMemoryStore } from "./insight-memory.store.ts";

/** The memory twin of `PrismaInsightReaderProjectionStore`. */
export class MemoryInsightReaderProjectionStore implements StateProjectionStore<InsightReaderState> {
  private constructor(private readonly rows: InsightMemoryStore) {}

  static create({ rows }: { rows: InsightMemoryStore }): MemoryInsightReaderProjectionStore {
    return new MemoryInsightReaderProjectionStore(rows);
  }

  async get(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<InsightReaderState>> {
    const projection = this.rows.readers.get(
      InsightMemoryStore.readerKey({
        projectId: String(context.tenantId),
        ...parseInsightReaderKey(key),
      }),
    );
    return projection ? { kind: "folded", projection } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<InsightReaderState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    this.rows.readers.set(
      InsightMemoryStore.readerKey({
        projectId: String(context.tenantId),
        ...parseInsightReaderKey(context.key ?? context.aggregateId),
      }),
      projection,
    );
  }
}
