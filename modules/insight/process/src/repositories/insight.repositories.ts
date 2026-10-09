import type { StateProjectionStore } from "@langwatch/eventing";

import type { InsightReaderState } from "../eventing/insight-reader.projection.ts";
import type { InsightState } from "../eventing/insight.projection.ts";
import type { InsightRepository } from "./insight.repository.ts";

export interface InsightRepositories {
  readonly insights: InsightRepository;
  readonly insightProjection: StateProjectionStore<InsightState>;
  readonly insightReaderProjection: StateProjectionStore<InsightReaderState>;
}
