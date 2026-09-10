import { counter, type CounterHandle } from "@langwatch/observability/metrics";
import {
  type LangyDispatchOutcome,
  LangyWorkerMetrics,
} from "../app/langy.infrastructure.ts";

export const LANGY_DISPATCH_METRIC_NAME = "langwatch_langy_dispatch_total";

/**
 * Langy worker-dispatch outcomes, pushed over OTLP.
 *
 * The counter was declared in the platform application's `server/metrics.ts`
 * while that process composed the dispatcher. It lives beside the port now, and
 * `apps/worker` composes it for the process that dispatches turns.
 */
export class OtelLangyWorkerMetricsAdapter extends LangyWorkerMetrics {
  static create(): OtelLangyWorkerMetricsAdapter {
    return new OtelLangyWorkerMetricsAdapter(
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
