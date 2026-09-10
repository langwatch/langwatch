import { CodingAgentReadMetrics } from "../app/coding-agent.members.ts";

export class NoopCodingAgentReadMetrics implements CodingAgentReadMetrics {
  static create(): NoopCodingAgentReadMetrics {
    return new NoopCodingAgentReadMetrics();
  }

  private constructor() {
  }

  observeSessionListRead(): void {}
}
