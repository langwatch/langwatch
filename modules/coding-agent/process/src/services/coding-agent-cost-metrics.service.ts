import { counter, type CounterHandle } from "@langwatch/observability/metrics";

import type { CodingAgentCostMetrics, CodingAgentCostMetric } from "../app/coding-agent.members.ts";

/** Cost-drift canary comparing registry vs agent pricing; see coding-agent-cost.feature. */
export class OtelCodingAgentCostMetricsService implements CodingAgentCostMetrics {
  private readonly recorded = new Set<string>();

  private constructor(
    private readonly computed: CounterHandle,
    private readonly reported: CounterHandle,
  ) {}

  static create(): OtelCodingAgentCostMetricsService {
    return new OtelCodingAgentCostMetricsService(
      counter({
        name: "coding_agent_cost_computed_usd_total",
        description: "Coding-agent cost computed from tokens against the model registry, in USD",
      }),
      counter({
        name: "coding_agent_cost_reported_usd_total",
        description: "Coding-agent cost as reported by the agent about its own bill, in USD",
      }),
    );
  }

  recordComputed(input: CodingAgentCostMetric): void {
    this.record("computed", this.computed, input);
  }

  recordReported(input: CodingAgentCostMetric): void {
    this.record("reported", this.reported, input);
  }

  private record(
    authority: "computed" | "reported",
    metric: CounterHandle,
    input: CodingAgentCostMetric,
  ): void {
    if (input.valueUsd <= 0) {
      return;
    }

    const key = `${authority}:${input.eventId}`;
    if (this.recorded.has(key)) {
      return;
    }

    if (this.recorded.size >= MAX_RECORDED_EVENT_IDS) {
      this.recorded.clear();
    }

    this.recorded.add(key);
    metric.inc({ agent: input.agent, model: input.model }, input.valueUsd);
  }
}

const MAX_RECORDED_EVENT_IDS = 100_000;
