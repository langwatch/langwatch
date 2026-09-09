export abstract class ScenarioProcessorServiceMetricsPort {
  abstract started(): void;

  abstract completed(durationMs: number): void;

  abstract failed(): void;
}
