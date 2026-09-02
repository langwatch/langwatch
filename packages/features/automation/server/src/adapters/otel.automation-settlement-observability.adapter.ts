import { counter, type CounterHandle } from "@langwatch/observability/metrics";
import { AutomationSettlementObservabilityPort } from "../ports/automation-settlement.port";

export const AUTOMATION_OVERFLOW_FLUSH_METRIC_NAME = "automation_overflow_flush_total";

/**
 * The overflow series, pushed over OTLP, with error capture delegated.
 *
 * The counter was declared in the platform application's `server/metrics.ts`
 * while that process supplied the port. It lives beside the port now.
 * `capture` stays the caller's, because where an error goes is a fact of the
 * process rather than of settlement — `apps/worker` logs it today
 * (`LoggedSettlementObservability`), and that composition can adopt this
 * adapter by passing its existing capture through.
 */
export class OtelAutomationSettlementObservabilityAdapter extends AutomationSettlementObservabilityPort {
  static create(options: {
    capture: (error: Error, extra: Record<string, unknown>) => void;
  }): OtelAutomationSettlementObservabilityAdapter {
    return new OtelAutomationSettlementObservabilityAdapter(
      counter({
        name: AUTOMATION_OVERFLOW_FLUSH_METRIC_NAME,
        description: "Matches flushed early because a settlement process hit its pending bound",
      }),
      options.capture,
    );
  }

  private constructor(
    private readonly overflowFlush: CounterHandle,
    private readonly captureError: (error: Error, extra: Record<string, unknown>) => void,
  ) {
    super();
  }

  /** Zero is not an overflow, and counting it would make every settlement look like one. */
  recordOverflow(flushed: number): void {
    if (flushed > 0) this.overflowFlush.inc({}, flushed);
  }

  capture(error: Error, extra: Record<string, unknown>): void {
    this.captureError(error, extra);
  }
}
