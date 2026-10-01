import { counter, type CounterHandle } from "@langwatch/observability/metrics";

import { type LangyDispatchOutcome, LangyWorkerMetrics } from "../channels/langy-worker.channel.ts";

export const LANGY_DISPATCH_METRIC_NAME = "langwatch_langy_dispatch_total";

/**
 * Langy worker-dispatch outcomes, pushed over OTLP. The counter was
 * declared in the platform application's `server/metrics.ts`; it now
 * lives beside the port, and `apps/worker` composes it for the dispatcher.
 */
export class LangyWorkerMetricsOtelService extends LangyWorkerMetrics {
  static create(): LangyWorkerMetricsOtelService {
    return new LangyWorkerMetricsOtelService(
      counter({
        name: LANGY_DISPATCH_METRIC_NAME,
        description: "Langy worker dispatch attempts by outcome",
      }),
    );
  }

  private constructor(private readonly dispatch: CounterHandle) {
    super();
  }

  recordDispatch(input: { outcome: LangyDispatchOutcome | "error" }): void {
    this.dispatch.inc({ outcome: input.outcome }, 1);
  }
}
