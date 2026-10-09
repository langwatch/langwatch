import type { InsightRepositories } from "../insight.repositories.ts";
import { InsightMemoryStore } from "./insight-memory.store.ts";
import { MemoryInsightReaderProjectionStore } from "./memory.insight-reader.store.ts";
import { MemoryInsightRepository } from "./memory.insight.repository.ts";
import { MemoryInsightProjectionStore } from "./memory.insight.store.ts";

/** The memory tier: the projections write the rows the read repository joins. */
export class MemoryInsightRepositories {
  static readonly requires = [] as const;

  static create(): InsightRepositories {
    const rows = InsightMemoryStore.create();
    return {
      insights: MemoryInsightRepository.create({ rows }),
      insightProjection: MemoryInsightProjectionStore.create({ rows }),
      insightReaderProjection: MemoryInsightReaderProjectionStore.create({ rows }),
    };
  }
}
