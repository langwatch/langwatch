import { counter, type CounterHandle } from "@langwatch/observability/metrics";

export const AUTOMATION_OVERFLOW_FLUSH_METRIC_NAME = "automation_overflow_flush_total";

/** The app's monitoring implementation is injected once at process
 * composition; settlement policy never imports app metrics or telemetry. */
export abstract class AutomationSettlementObservability {
  abstract recordOverflow(flushed: number): void;
  abstract capture(error: Error, extra: Record<string, unknown>): void;
}

/**
 * The overflow series, pushed over OTLP, with error capture delegated.
 *
 * The counter was declared in the platform application's `server/metrics.ts`
 * while that process supplied this collaborator. It lives beside the
 * interface now. `capture` stays the caller's, because where an error goes is
 * a fact of the process rather than of settlement — `apps/worker` logs it
 * today (`LoggedSettlementObservability`), and that composition can adopt
 * this service by passing its existing capture through.
 */
export class OtelAutomationSettlementObservabilityAdapter extends AutomationSettlementObservability {
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
