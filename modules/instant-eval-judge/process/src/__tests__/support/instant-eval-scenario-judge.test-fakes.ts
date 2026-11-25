import {
  instantEvalJudgeRouteTableSchema,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalJudgeRouteTable,
  type InstantEvalScenarioJudgeCall,
} from "@langwatch/instant-eval-judge-contract";

/**
 * A made-up table shaped like a scenario route: a decision model that escalates unsure criteria
 * to an LLM, one pair of legs per length bucket, and an LLM for the turn decision. Invented names,
 * bounds and thresholds, so a suite never carries a deployment's table.
 */
export function syntheticScenarioRouteTable(
  overrides: { backends?: Record<string, unknown>; scenarioDecision?: unknown } = {},
): InstantEvalJudgeRouteTable {
  const jevAlone = {
    short: { instant: { primary: "decision-b" } },
    long: { instant: { primary: "decision-b" } },
    arithmetic: { instant: { primary: "decision-b" } },
  };
  const short = {
    instant: { primary: "llm-a" },
    balanced: { primary: "decision-a", escalateTo: "llm-a", threshold: 0.98 },
  };
  return instantEvalJudgeRouteTableSchema.parse({
    version: 1,
    defaultMode: { search: "instant", llm_judge: "instant", scenario_judge: "balanced" },
    buckets: [
      { name: "short", maxTokens: 7999 },
      { name: "long", maxTokens: null },
    ],
    arithmetic: {
      maxTokens: 0,
      source: { search: "request", llm_judge: "request", scenario_judge: "request" },
    },
    backends: {
      "decision-a": { kind: "decisions", model: "decision-model-a" },
      "decision-b": { kind: "jev" },
      "llm-a": { kind: "openai_responses", model: "llm-model-a", timeoutMs: 5000 },
      "llm-b": { kind: "anthropic_messages", model: "llm-model-b", timeoutMs: 5000 },
      ...overrides.backends,
    },
    routes: {
      search: jevAlone,
      llm_judge: jevAlone,
      scenario_judge: {
        short,
        long: {
          instant: { primary: "llm-b" },
          balanced: { primary: "decision-b", escalateTo: "llm-b", threshold: 0.8 },
        },
        arithmetic: short,
      },
    },
    scenarioDecision:
      "scenarioDecision" in overrides ? overrides.scenarioDecision : { backend: "llm-a" },
  });
}

/** Round prices, so a judgement's cost is read off its tokens. */
export const SYNTHETIC_SCENARIO_PRICING: InstantEvalJudgeRoutePricing = {
  version: "scenario-test",
  backends: {
    "decision-a": { usdPerMillionInputTokens: 1, usdPerMillionOutputTokens: 0 },
    "decision-b": { usdPerMillionInputTokens: 2, usdPerMillionOutputTokens: 0 },
    "llm-a": { usdPerMillionInputTokens: 10, usdPerMillionOutputTokens: 100 },
    "llm-b": { usdPerMillionInputTokens: 20, usdPerMillionOutputTokens: 200 },
  },
};

const FINISH_TEST = {
  name: "finish_test",
  description: "Complete the test with a final verdict",
  parameters: { type: "object", properties: { criteria: { type: "object" } } },
};
const CONTINUE_TEST = {
  name: "continue_test",
  description: "Continue the test with the next step",
  parameters: { type: "object", properties: {} },
};
const MAKE_VERDICT = {
  name: "make_verdict",
  description: "End the conversation and move to the verdict.",
  parameters: { type: "object", properties: {} },
};

/** A scenario judge call as the scenario judge sends it, with made-up criteria. */
export function scenarioJudgeCall(
  overrides: Partial<InstantEvalScenarioJudgeCall> = {},
): InstantEvalScenarioJudgeCall {
  const phase = overrides.phase ?? "verdict";
  return {
    projectId: "project-1",
    phase,
    description: "A customer asks for a refund on a late order",
    content: "<transcript>user: my order is late\nassistant: I refunded it</transcript>",
    criteria: [
      { key: "criterion_0", text: "The agent offers a refund" },
      { key: "criterion_1", text: "The agent apologises" },
      { key: "criterion_2", text: "The agent does not ask for a card number" },
    ],
    llmCall: {
      system: "You are an LLM as a judge delivering the final verdict",
      user: "<transcript>user: my order is late\nassistant: I refunded it</transcript>",
      tools: phase === "verdict" ? [FINISH_TEST] : [CONTINUE_TEST, MAKE_VERDICT],
    },
    ...overrides,
  };
}
