import { counter, type CounterHandle } from "@langwatch/observability/metrics";

/**
 * The three containment series, and a sink that records nothing.
 *
 * `AutomationRunawayPort` mixes infrastructure the policy needs (email,
 * leases, project reads) with three pure observations. Only the observations
 * are declared here, so a composition root can delegate `onCeilingBreach`,
 * `onAutoPaused` and `onContainmentFailed` to this sink without the sink
 * having to satisfy the whole port.
 *
 * They were declared in the platform application's `server/metrics.ts` while
 * that process owned the wiring. That process is gone, so they live beside
 * the port whose methods increment them. Nothing composes the OTLP sink yet:
 * `apps/api` logs the three events (`UncontainedApiAutomationRunaway`) and
 * `apps/worker` composes no containment at all, so the default in force is
 * `NoopAutomationRunawayMetrics` and the series are unpublished. That is a
 * wiring decision in each root, not a code move — and unpublished is the
 * honest state, because a panel that is flat because nothing writes the
 * metric reads exactly like an automation fleet that never breached.
 */
export abstract class AutomationRunawayMetricsSink {
  abstract onCeilingBreach(): void;
  abstract onAutoPaused(reason: string): void;
  abstract onContainmentFailed(): void;
}

export const AUTOMATION_CEILING_BREACH_METRIC_NAME = "automation_ceiling_breach_total";
export const AUTOMATION_AUTO_PAUSED_METRIC_NAME = "automation_auto_paused_total";
export const AUTOMATION_CONTAINMENT_FAILED_METRIC_NAME = "automation_containment_failed_total";

/** Containment counts, pushed over OTLP. */
export class OtelAutomationRunawayMetricsAdapter extends AutomationRunawayMetricsSink {
  static create(): OtelAutomationRunawayMetricsAdapter {
    return new OtelAutomationRunawayMetricsAdapter(
      counter({
        name: AUTOMATION_CEILING_BREACH_METRIC_NAME,
        description: "Confirmed automation matches dropped for passing their daily ceiling",
      }),
      counter({
        name: AUTOMATION_AUTO_PAUSED_METRIC_NAME,
        description: "Automations the platform paused, by reason",
      }),
      counter({
        name: AUTOMATION_CONTAINMENT_FAILED_METRIC_NAME,
        description:
          "Breaches where containment could not pause the automation or tell the customer",
      }),
    );
  }

  private constructor(
    private readonly ceilingBreach: CounterHandle,
    private readonly autoPaused: CounterHandle,
    private readonly containmentFailed: CounterHandle,
  ) {
    super();
  }

  onCeilingBreach(): void {
    this.ceilingBreach.inc({}, 1);
  }

  onAutoPaused(reason: string): void {
    this.autoPaused.inc({ reason }, 1);
  }

  onContainmentFailed(): void {
    this.containmentFailed.inc({}, 1);
  }
}

/** Records nothing. The default for a process that publishes no containment metrics. */
export class NoopAutomationRunawayMetrics extends AutomationRunawayMetricsSink {
  static create(): NoopAutomationRunawayMetrics {
    return new NoopAutomationRunawayMetrics();
  }

  private constructor() {
    super();
  }

  onCeilingBreach(): void {}
  onAutoPaused(): void {}
  onContainmentFailed(): void {}
}
