import type { AnalyticsMetricSource } from "@langwatch/analytics-contract";
import type { Instant } from "@langwatch/time";

/** When a project's newest analytics row occurred, per source. */
export abstract class AnalyticsRecencyRepository {
  /** Empty when the project has no row of that source since `since`, left-out traces aside. */
  abstract findLastOccurredAt(input: {
    projectId: string;
    source: AnalyticsMetricSource;
    since: Instant;
    excludeOrigins?: readonly string[];
    excludeConversationIds?: readonly string[];
  }): Promise<Instant[]>;
}
