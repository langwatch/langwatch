import { Counter, register } from "prom-client";
import {
  CodingAgentCostMetricsPort,
  type CodingAgentCostMetric,
} from "../ports/coding-agent-cost-metrics.port";

/**
 * The cost-drift canary (see specs/trace-processing/coding-agent-cost.feature).
 *
 * Two dollar counters, one per pricing authority: what the model registry
 * computes for a call's tokens, and what the agent reports it was billed for
 * the same call. Per model, because that is the grain a stale price lives at:
 * their ratio drifting from ~1 for one model is the alarm that either our
 * registry or the agent's own pricing went stale — it caught the registry
 * pricing hour-long cache writes short-lived, and Claude Code billing Sonnet 5
 * at a withdrawn price, on the same day.
 *
 * Recorded after contribution events commit. A bounded, process-local event-id
 * set suppresses immediate queue redelivery while avoiding unbounded memory.
 * Prometheus counters and this set both reset on worker restart, so this is an
 * operational metric rather than a durable billing ledger.
 */
const metricNames = [
  "coding_agent_cost_computed_usd_total",
  "coding_agent_cost_reported_usd_total",
] as const;
const MAX_RECORDED_EVENT_IDS = 100_000;

export class PrometheusCodingAgentCostMetricsAdapter extends CodingAgentCostMetricsPort {
  private readonly recorded = new Set<string>();

  private constructor(
    private readonly computed: Counter<"agent" | "model">,
    private readonly reported: Counter<"agent" | "model">,
  ) {
    super();
  }

  static create(): PrometheusCodingAgentCostMetricsAdapter {
    for (const name of metricNames) {
      register.removeSingleMetric(name);
    }

    return new PrometheusCodingAgentCostMetricsAdapter(
      new Counter({
        name: metricNames[0],
        help: "Coding-agent cost computed from tokens against the model registry, in USD",
        labelNames: ["agent", "model"] as const,
      }),
      new Counter({
        name: metricNames[1],
        help: "Coding-agent cost as reported by the agent about its own bill, in USD",
        labelNames: ["agent", "model"] as const,
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
    counter: Counter<"agent" | "model">,
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
    counter.inc({ agent: input.agent, model: input.model }, input.valueUsd);
  }
}
