import type { Logger } from "@langwatch/observability";
import type { ResourceScope } from "@langwatch/runtime-composition";
import type { TraceProductAnalytics } from "@langwatch/trace-server";
import { WorkerPostHogProductAnalyticsAdapter } from "../platform/infrastructure/worker-product-analytics.adapter.ts";
import type { WorkerProductAnalyticsConfig } from "../platform/config/worker.config.ts";

/**
 * Staged but not mounted; delivers product-analytics sink from PostHog.
 */
export function createWorkerTraceProductAnalytics(options: {
  config: WorkerProductAnalyticsConfig;
  resources?: ResourceScope;
  logger?: Logger;
}): TraceProductAnalytics {
  const analytics = WorkerPostHogProductAnalyticsAdapter.create({
    config: options.config,
    logger: options.logger,
  });
  options.resources?.own("worker product analytics", () => analytics.close());
  return analytics;
}
