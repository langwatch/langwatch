import { Counter, register } from "prom-client";

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
 * Incremented in the session fold's handlers, so a refold wave replays them;
 * both counters replay proportionally, and the alert reads the ratio of
 * rates, so the alarm's meaning survives a refold.
 */
const metricNames = [
  "coding_agent_cost_computed_usd_total",
  "coding_agent_cost_reported_usd_total",
] as const;

// Remove existing metrics if they exist (for hot reload)
for (const name of metricNames) {
  register.removeSingleMetric(name);
}

export const codingAgentCostComputedUsd = new Counter({
  name: "coding_agent_cost_computed_usd_total",
  help: "Coding-agent cost computed from tokens against the model registry, in USD",
  labelNames: ["agent", "model"] as const,
});

export const codingAgentCostReportedUsd = new Counter({
  name: "coding_agent_cost_reported_usd_total",
  help: "Coding-agent cost as reported by the agent about its own bill, in USD",
  labelNames: ["agent", "model"] as const,
});
