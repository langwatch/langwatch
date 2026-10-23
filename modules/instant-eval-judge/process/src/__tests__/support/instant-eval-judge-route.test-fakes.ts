import {
  instantEvalJudgeRouteTableSchema,
  type InstantEvalBooleanQuestion,
  type InstantEvalJudgeRouteTable,
} from "@langwatch/instant-eval-judge-contract";

/**
 * A made-up route table shaped like a real one: invented backend names, bounds, thresholds and
 * picks, so a suite never carries a deployment's table.
 */
export function syntheticRouteTable(
  overrides: { backends?: Record<string, unknown>; inputViews?: unknown } = {},
): InstantEvalJudgeRouteTable {
  const escalating = {
    instant: { primary: "decision-a", pairWith: "decision-b" },
    balanced: { primary: "decision-a", escalateTo: "llm-b", threshold: 0.6 },
    accurate: { primary: "llm-b" },
  };
  return instantEvalJudgeRouteTableSchema.parse({
    version: 1,
    defaultMode: { search: "balanced", llm_judge: "balanced", scenario_judge: "instant" },
    buckets: [
      { name: "short", maxTokens: 1500 },
      { name: "medium", maxTokens: 6000 },
      { name: "long", maxTokens: null },
    ],
    arithmetic: {
      maxTokens: 6000,
      source: { search: "request_then_regex", llm_judge: "regex", scenario_judge: "request" },
    },
    inputViews: { default: "full", byCategory: { sentiment: "text", tool_args: "full" } },
    backends: {
      "decision-a": { kind: "decisions", model: "decision-model-a", fallbacks: ["decision-b"] },
      "decision-b": { kind: "jev" },
      "llm-a": { kind: "anthropic_messages", model: "llm-model-a" },
      "llm-b": { kind: "openai_responses", model: "llm-model-b" },
      ...overrides.backends,
    },
    routes: {
      search: {
        short: escalating,
        medium: { instant: { primary: "decision-a", pairWith: "decision-b" } },
        long: { instant: { primary: "decision-a" }, balanced: { primary: "llm-a" } },
        arithmetic: { instant: { primary: "decision-a" }, balanced: { primary: "llm-b" } },
      },
      llm_judge: {
        short: escalating,
        medium: escalating,
        long: {
          instant: { primary: "decision-a" },
          balanced: { primary: "decision-a", escalateTo: "llm-a", threshold: 0.6 },
        },
        arithmetic: { instant: { primary: "decision-a" }, balanced: { primary: "llm-a" } },
      },
      scenario_judge: {
        short: { instant: { primary: "decision-b" } },
        medium: { instant: { primary: "decision-a" } },
        long: { instant: { primary: "decision-b" } },
        arithmetic: { instant: { primary: "decision-b" } },
      },
    },
    ...(overrides.inputViews ? { inputViews: overrides.inputViews } : {}),
  });
}

export function yesNo(id: string, instructions: string): InstantEvalBooleanQuestion {
  return { id, kind: "boolean", instructions };
}
