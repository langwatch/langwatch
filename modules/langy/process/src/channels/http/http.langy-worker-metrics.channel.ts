import { counter, type CounterHandle } from "@langwatch/observability/metrics";

import { type LangyDispatchOutcome, LangyWorkerMetrics } from "../langy-worker.channel.ts";

const LANGY_DISPATCH_METRIC_NAME = "langwatch_langy_dispatch_total";

/** Langy worker-dispatch outcomes, pushed over OTLP. */
export class HttpLangyWorkerMetricsChannel extends LangyWorkerMetrics {
  static create(): HttpLangyWorkerMetricsChannel {
    return new HttpLangyWorkerMetricsChannel(
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
