import type { AnalyticsService } from "@langwatch/analytics-contract";
import { AnalyticsAdapter } from "@langwatch/analytics-server";

/**
 * The client shape Analytics reads through.
 *
 * Derived from the adapter rather than restated because it is WIDER than the
 * two methods `@langwatch/eventing` narrowed its own resolver to: the analytics
 * repositories reach for the driver's own result-set handling. The composition
 * root holds the deployment's real client and is where the two shapes meet.
 */
export type WorkerAnalyticsClickHouseResolver = Parameters<
  typeof AnalyticsAdapter.create
>[0]["resolveClient"];

/**
 * The timeseries reader the graph-alert subscriber asks its question through.
 *
 * IT WAS NEVER THE WALL the halt record listed it beside. Every other
 * capability service on that list needed Postgres, an organization service or a
 * credential codec; this one is a ClickHouse repository over the same
 * tenant-keyed client this process already resolves its event store through, so
 * it needed a package dependency and nothing else.
 *
 * WHAT IT ANSWERS. `subscriber:graphTriggerActivity` re-evaluates a customer's
 * graph alert against the metric the alert is about — "error rate over the last
 * hour", "spend today" — and that metric is an analytics timeseries. Without
 * it the subscriber would register, receive every trace, and be unable to
 * decide anything, so a graph alert would simply never fire.
 *
 * `clickhouseEnabled` is `true` rather than configurable, and the same
 * reasoning the metric, log and suite adapters give applies: a consumer of
 * `event-sourcing/jobs` without an event store is refused before any capability
 * is built, so there is no graph in which this composes and ClickHouse is
 * absent.
 */
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
