import type { InsightRepositories } from "../insight.repositories.ts";
import { InsightMemoryStore } from "./insight-memory.store.ts";
import { MemoryInsightDailyScheduleProjectionRepository } from "./memory.insight-daily-schedule-projection.repository.ts";
import { MemoryInsightDailyScheduleRepository } from "./memory.insight-daily-schedule.repository.ts";
import { MemoryInsightProjectionRepository } from "./memory.insight-projection.repository.ts";
import { MemoryInsightReaderProjectionRepository } from "./memory.insight-reader-projection.repository.ts";
import { MemoryInsightRepository } from "./memory.insight.repository.ts";

/** The memory tier: the projections write the rows the read repository joins. */
export class MemoryInsightRepositories {
  static readonly requires = [] as const;

  static create(): InsightRepositories {
    const rows = InsightMemoryStore.create();
    return {
      insights: MemoryInsightRepository.create({ rows }),
      insightProjection: MemoryInsightProjectionRepository.create({ rows }),
      insightReaderProjection: MemoryInsightReaderProjectionRepository.create({ rows }),
      dailySchedules: MemoryInsightDailyScheduleRepository.create({ rows }),
      dailyScheduleProjection: MemoryInsightDailyScheduleProjectionRepository.create({ rows }),
    };
  }
}
