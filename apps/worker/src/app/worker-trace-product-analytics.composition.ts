import type { Logger } from "@langwatch/observability";
import type { ResourceScope } from "@langwatch/runtime-composition";
import type { TraceProductAnalyticsPort } from "@langwatch/trace-server";
import { WorkerPostHogProductAnalyticsAdapter } from "../platform/infrastructure/worker-product-analytics.adapter";
import type { WorkerProductAnalyticsConfig } from "../platform/config/worker.config";

/**
 * The one product-usage sink this process records through.
 *
 * STAGED, NOT MOUNTED. Trace has not converted — the application still
 * registers `projectMetadata` and still calls `trackServerEvent` from it — so
 * nothing in this process captures an event yet. What has to be true today is
 * that this composition root CAN deliver `first_trace_integrated` for real
 * before `projectMetadata` is mounted here, which is what the ledger recorded
 * as a named absence blocking the conversion.
 *
 *     TraceProductAnalyticsPort                    (trace-server declares it)
 *       └─ WorkerPostHogProductAnalyticsAdapter    posthog-node, lazily built
 *            └─ config.productAnalytics            POSTHOG_KEY / POSTHOG_HOST
 *
 * The capture client is ALWAYS composed, including on a deployment that named
 * no key, and this is deliberate. The adapter's own key-absent branch is the
 * application's — `trackServerEvent` no-ops on the same input — so returning
 * `undefined` here would make the caller invent a second no-op that could
 * disagree with it, and would hide the decision from the one place a reader
 * looks for it.
 *
 * The scope OWNS the sink when it is given one. The client batches, so a
 * process that exited without flushing would silently drop a milestone that
 * nothing re-sends; the application flushes from its graceful shutdown
 * sequence for exactly that reason, and this is the same seam.
 */
export function createWorkerTraceProductAnalytics(options: {
  config: WorkerProductAnalyticsConfig;
  resources?: ResourceScope;
  logger?: Logger;
}): TraceProductAnalyticsPort {
  const analytics = WorkerPostHogProductAnalyticsAdapter.create({
    config: options.config,
    logger: options.logger,
  });
  options.resources?.own("worker product analytics", () => analytics.close());
  return analytics;
}
