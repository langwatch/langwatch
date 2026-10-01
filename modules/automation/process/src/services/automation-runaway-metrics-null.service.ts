import { AutomationRunawayMetricsSink } from "../app/automation.members.ts";

/** Records nothing. The default for a process that publishes no containment metrics. */
export class AutomationRunawayMetricsNullService extends AutomationRunawayMetricsSink {
  static create(): AutomationRunawayMetricsNullService {
    return new AutomationRunawayMetricsNullService();
  }

  private constructor() {
    super();
  }

  onCeilingBreach(): void {}

  onAutoPaused(): void {}

  onContainmentFailed(): void {}
}
