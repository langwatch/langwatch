/**
 * Every block a dashboard can show: the Analytics v2 library blocks, the new
 * rate, percentile and comparison blocks, and the ten Agent Flight Deck
 * panels in prototype order. Code-defined, never persisted.
 */

import type { BlockDefinition } from "./block-definition.ts";
import * as sql from "./block-queries.ts";

const main = (text: string) => [{ name: "main", sql: text }];

export const LIBRARY_BLOCKS: readonly BlockDefinition[] = [
  {
    id: "trace-count-over-time",
    title: "Trace count over time",
    subtitle: "How many traces arrived in each interval",
    source: "traces",
    width: "half",
    view: "line",
    queries: main(sql.TRACE_COUNT_SQL),
  },
  {
    id: "total-cost-over-time",
    title: "Total cost over time",
    subtitle: "What your agents spent in each interval",
    source: "traces",
    width: "half",
    view: "line",
    unit: "usd",
    queries: main(sql.TOTAL_COST_SQL),
  },
  {
    id: "tokens-over-time",
    title: "Tokens over time",
    subtitle: "Prompt and completion tokens in each interval",
    source: "traces",
    width: "half",
    view: "line",
    unit: "tokens",
    queries: main(sql.TOKENS_SQL),
  },
  {
    id: "latency-percentiles",
    title: "Latency percentiles",
    subtitle: "p50, p90 and p99 trace duration",
    source: "traces",
    width: "half",
    view: "line",
    unit: "ms",
    queries: main(sql.LATENCY_PERCENTILES_SQL),
  },
  {
    id: "satisfaction-over-time",
    title: "Satisfaction over time",
    subtitle: "Average satisfaction score of your traces",
    source: "traces",
    width: "half",
    view: "line",
    unit: "score",
    queries: main(sql.SATISFACTION_SQL),
  },
  {
    id: "evaluation-pass-rate",
    title: "Evaluation pass rate",
    subtitle: "Share of evaluations that passed",
    source: "judges",
    width: "half",
    view: "line",
    unit: "ratio",
    queries: main(sql.EVALUATION_PASS_RATE_SQL),
  },
  {
    id: "average-traces-per-thread",
    title: "Average traces per thread",
    subtitle: "How long your conversations run",
    source: "traces",
    width: "half",
    view: "line",
    unit: "score",
    queries: main(sql.TRACES_PER_THREAD_SQL),
  },
  {
    id: "top-models",
    title: "Top models",
    subtitle: "Models used by the most traces",
    source: "traces",
    width: "half",
    view: "ranking",
    queries: main(sql.TOP_MODELS_SQL),
  },
  {
    id: "top-topics",
    title: "Top topics",
    subtitle: "What your users ask about most",
    source: "traces",
    width: "half",
    view: "ranking",
    queries: main(sql.TOP_TOPICS_SQL),
  },
  {
    id: "error-rate-over-time",
    title: "Error rate over time",
    subtitle: "Share of traces that ended in an error",
    source: "traces",
    width: "half",
    view: "line",
    unit: "ratio",
    queries: main(sql.ERROR_RATE_SQL),
  },
  {
    id: "p95-latency-over-time",
    title: "p95 latency over time",
    subtitle: "How slow the slowest five percent of traces are",
    source: "traces",
    width: "half",
    view: "line",
    unit: "ms",
    queries: main(sql.P95_LATENCY_SQL),
  },
  {
    id: "previous-period-comparison",
    title: "Compared with the previous period",
    subtitle: "Volume, success rate, p95 latency and cost against the period before",
    source: "traces",
    width: "full",
    view: "status",
    queries: main(sql.PERIOD_COMPARISON_SQL),
  },
  {
    id: "scenario-pass-rate",
    title: "Scenario pass rate",
    subtitle: "Share of scenario runs the judge passed",
    source: "scenarios",
    width: "half",
    view: "line",
    unit: "ratio",
    queries: main(sql.SCENARIO_PASS_RATE_SQL),
  },
];

export const FLIGHT_DECK_BLOCKS: readonly BlockDefinition[] = [
  {
    id: "fd-status",
    title: "Status",
    subtitle: "Traffic, quality, latency and cost at a glance",
    source: "traces",
    width: "full",
    view: "status",
    queries: main(sql.PERIOD_COMPARISON_SQL),
  },
  {
    id: "fd-overlay",
    title: "Throughput, latency & errors",
    subtitle: "Correlate traffic spikes with degradation",
    source: "traces",
    width: "full",
    view: "throughput",
    queries: main(sql.THROUGHPUT_SQL),
  },
  {
    id: "fd-cost",
    title: "Cost efficiency",
    subtitle: "What the spend buys",
    source: "traces",
    width: "half",
    view: "costEfficiency",
    queries: [
      { name: "summary", sql: sql.COST_SUMMARY_SQL },
      { name: "models", sql: sql.COST_BY_MODEL_SQL },
    ],
  },
  {
    id: "fd-failures",
    title: "Failure intelligence",
    subtitle: "Top error categories in the window",
    source: "traces",
    width: "half",
    view: "failures",
    queries: main(sql.FAILURES_SQL),
  },
  {
    id: "fd-scenarios",
    title: "Scenario results",
    subtitle: "How much behaviour your scenario suites exercise",
    source: "scenarios",
    width: "half",
    view: "scenarios",
    queries: [
      { name: "summary", sql: sql.SCENARIO_SUMMARY_SQL },
      { name: "suites", sql: sql.SCENARIO_SUITES_SQL },
    ],
  },
  {
    id: "fd-judges",
    title: "Quality signal",
    subtitle: "Evaluator pass rate over time, against the error rate",
    source: "judges",
    width: "half",
    view: "quality",
    queries: [
      { name: "passRate", sql: sql.EVALUATION_PASS_RATE_SQL },
      { name: "errorRate", sql: sql.ERROR_RATE_SQL },
    ],
  },
  {
    id: "fd-feedback",
    title: "User feedback",
    subtitle: "What users think of the answers",
    source: "feedback",
    width: "half",
    view: "feedback",
    queries: [
      { name: "summary", sql: sql.FEEDBACK_SUMMARY_SQL },
      { name: "rate", sql: sql.FEEDBACK_RATE_SQL },
    ],
  },
  {
    id: "fd-gateway",
    title: "Gateway routing",
    subtitle: "Cost broken down by virtual key / route",
    source: "gateway",
    width: "half",
    view: "gateway",
    queries: main(sql.GATEWAY_ROUTES_SQL),
  },
  {
    id: "fd-coding-agents",
    title: "Your coding agents",
    subtitle: "Sessions, spend and success across Claude Code, Cursor and Codex",
    source: "codingAgents",
    width: "full",
    view: "codingAgents",
    queries: [
      { name: "agents", sql: sql.CODING_AGENTS_SQL },
      { name: "trend", sql: sql.CODING_AGENT_TREND_SQL },
    ],
  },
  {
    id: "fd-drilldown",
    title: "Most impactful traces",
    subtitle: "Ranked by blended impact: errors, extreme latency, cost, negative feedback",
    source: "traces",
    width: "full",
    view: "impactfulTraces",
    queries: main(sql.IMPACTFUL_TRACES_SQL),
  },
];

export const BLOCK_REGISTRY: readonly BlockDefinition[] = [
  ...LIBRARY_BLOCKS,
  ...FLIGHT_DECK_BLOCKS,
];

/** A block by id, or undefined for an id no block carries. */
export function findBlock(id: string): BlockDefinition | undefined {
  return BLOCK_REGISTRY.find((block) => block.id === id);
}
