import { counter, type CounterHandle } from "@langwatch/observability/metrics";

export const AUTOMATION_OVERFLOW_FLUSH_METRIC_NAME = "automation_overflow_flush_total";

/** The app's monitoring implementation is injected once at process
 * composition; settlement policy never imports app metrics or telemetry. */
export abstract class AutomationSettlementObservability {
  abstract recordOverflow(flushed: number): void;
  abstract capture(error: Error, extra: Record<string, unknown>): void;
}

/**
 * OTLP overflow metric with error capture delegated, since error handling is
 * process-specific (e.g., app logs vs. worker logging strategy).
 */
export class AutomationSettlementObservabilityService extends AutomationSettlementObservability {
  static create(options: {
    capture: (error: Error, extra: Record<string, unknown>) => void;
  }): AutomationSettlementObservabilityService {
    return new AutomationSettlementObservabilityService(
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
