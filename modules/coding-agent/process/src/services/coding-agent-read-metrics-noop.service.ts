import type { CodingAgentReadMetrics } from "../app/coding-agent.members.ts";

export class NoopCodingAgentReadMetricsService implements CodingAgentReadMetrics {
  static create(): NoopCodingAgentReadMetricsService {
    return new NoopCodingAgentReadMetricsService();
  }

  private constructor() {}

  observeSessionListRead(): void {}
}
