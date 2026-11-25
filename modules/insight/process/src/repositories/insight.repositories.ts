import type { StateProjectionStore } from "@langwatch/eventing";

import type { InsightDailyScheduleState } from "../eventing/insight-daily-schedule.projection.ts";
import type { InsightReaderState } from "../eventing/insight-reader.projection.ts";
import type { InsightState } from "../eventing/insight.projection.ts";
import type { InsightDailyScheduleRepository } from "./insight-daily-schedule.repository.ts";
import type { InsightRepository } from "./insight.repository.ts";

export interface InsightRepositories {
  readonly insights: InsightRepository;
  readonly insightProjection: StateProjectionStore<InsightState>;
  readonly insightReaderProjection: StateProjectionStore<InsightReaderState>;
  readonly dailySchedules: InsightDailyScheduleRepository;
  readonly dailyScheduleProjection: StateProjectionStore<InsightDailyScheduleState>;
}
