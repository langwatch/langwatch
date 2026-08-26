export type CodingAgentSessionListReadOutcome = "hit" | "empty" | "error";

/** Observes the bounded session-list storage read without coupling the feature to app metrics. */
export abstract class CodingAgentReadMetricsPort {
  abstract observeSessionListRead(input: {
    table: string;
    outcome: CodingAgentSessionListReadOutcome;
    durationMs: number;
  }): void;
}

export class NoopCodingAgentReadMetricsPort extends CodingAgentReadMetricsPort {
  static create(): NoopCodingAgentReadMetricsPort {
    return new NoopCodingAgentReadMetricsPort();
  }

  private constructor() {
    super();
  }

  observeSessionListRead(): void {}
}
