import type { Instant } from "@langwatch/time";

import { AnalyticsRecencyRepository } from "../analytics-recency.repository.ts";

/** The memory tier holds no analytics rows, so no source has a newest one. */
export class MemoryAnalyticsRecencyRepository extends AnalyticsRecencyRepository {
  static create(): MemoryAnalyticsRecencyRepository {
    return new MemoryAnalyticsRecencyRepository();
  }

  private constructor() {
    super();
  }

  findLastOccurredAt(): Promise<Instant[]> {
    return Promise.resolve([]);
  }
}
