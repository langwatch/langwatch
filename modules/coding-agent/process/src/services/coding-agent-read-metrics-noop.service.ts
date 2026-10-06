import type { CodingAgentReadMetrics } from "../repositories/coding-agent-session.repository.ts";

export class NoopCodingAgentReadMetricsService implements CodingAgentReadMetrics {
  static create(): NoopCodingAgentReadMetricsService {
    return new NoopCodingAgentReadMetricsService();
  }

  private constructor() {}

  observeSessionListRead(): void {}
}
