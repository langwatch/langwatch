/** Telemetry and logging the containment policy reports as it runs. */
export abstract class AutomationRunawaySignals {
  abstract onCeilingBreach(): void;
  abstract onAutoPaused(reason: string): void;
  abstract onContainmentFailed(): void;
  abstract error(fields: Record<string, unknown>, message: string): void;
  abstract info(fields: Record<string, unknown>, message: string): void;
}
