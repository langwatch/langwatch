import type { AnalyticsService } from "@langwatch/analytics-contract";
import { AnalyticsAdapter } from "@langwatch/analytics-server";

/**
 * The client shape Analytics reads through. Derived from the adapter rather
 * than restated: it is WIDER than the two methods `@langwatch/eventing`
 * narrowed its resolver to, since the repositories use the driver's own result-set handling.
 */
export type WorkerAnalyticsClickHouseResolver = Parameters<
  typeof AnalyticsAdapter.create
>[0]["resolveClient"];

// Timeseries reader the graph-alert subscriber uses to re-evaluate alerts
// against the metrics they track
export function createWorkerAnalytics(options: {
  resolveClickHouseClient: WorkerAnalyticsClickHouseResolver;
  /** The number the event store already stamps its own rows with. */
  defaultRetentionDays: number;
}): AnalyticsService {
  return AnalyticsAdapter.create({
    resolveClient: options.resolveClickHouseClient,
    clickhouseEnabled: true,
    defaultRetentionDays: options.defaultRetentionDays,
  });
}
