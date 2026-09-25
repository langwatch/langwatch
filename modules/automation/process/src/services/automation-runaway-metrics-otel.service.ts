import { counter, type CounterHandle } from "@langwatch/observability/metrics";

import { AutomationRunawayMetricsSink } from "../app/automation.members.ts";

export const AUTOMATION_CEILING_BREACH_METRIC_NAME = "automation_ceiling_breach_total";
export const AUTOMATION_AUTO_PAUSED_METRIC_NAME = "automation_auto_paused_total";
export const AUTOMATION_CONTAINMENT_FAILED_METRIC_NAME = "automation_containment_failed_total";

/** Containment counts, pushed over OTLP. */
export class AutomationRunawayMetricsOtelService extends AutomationRunawayMetricsSink {
  static create(): AutomationRunawayMetricsOtelService {
    return new AutomationRunawayMetricsOtelService(
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
