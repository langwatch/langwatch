import {
  instantEvalJudgeRouteTableSchema,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalJudgeRouteTable,
  type InstantEvalScenarioJudgeCall,
  type InstantEvalScenarioJudgeTool,
} from "@langwatch/instant-eval-judge-contract";
import { z } from "zod";

import finishTestTool from "./scenario-sdk-finish-test.json" with { type: "json" };

/** The statuses the SDK's tool offers per criterion, read from the fixture itself. */
const STATUSES_OF_FIXTURE = finishTestTool.parameters.properties.criteria.properties.criterion_0
  .properties.status.enum as ["passed", "failed", "inconclusive"];

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

/**
 * A made-up table shaped like a gated scenario route: under the bound a gate picks a decision
 * model or an LLM that sets an effort, above it a classifier escalates to a long-context LLM.
 */
export function syntheticGatedScenarioRouteTable(): InstantEvalJudgeRouteTable {
  const base = syntheticScenarioRouteTable({
    backends: {
      "gate-a": { kind: "jev", timeoutMs: 5000 },
      "llm-a": {
        kind: "openai_responses",
        model: "llm-model-a",
        reasoningEffort: "medium",
      },
      "llm-c": { kind: "gemini_generate_content", model: "llm-model-c", timeoutMs: 5000 },
    },
    scenarioDecision: { backend: "llm-c" },
  });
  const short = {
    instant: { primary: "llm-a" },
    balanced: {
      primary: "decision-a",
      escalateTo: "llm-a",
      gate: { backend: "gate-a", question: "difficulty_v1", easyBelow: 0.75 },
    },
  };
  return instantEvalJudgeRouteTableSchema.parse({
    ...base,
    routes: {
      ...base.routes,
      scenario_judge: {
        short,
        long: {
          instant: { primary: "llm-c" },
          balanced: { primary: "decision-b", escalateTo: "llm-c", threshold: 0.9 },
        },
        arithmetic: short,
      },
    },
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
    "llm-c": { usdPerMillionInputTokens: 30, usdPerMillionOutputTokens: 300 },
    "gate-a": { usdPerMillionInputTokens: 5, usdPerMillionOutputTokens: 0 },
  },
};

/**
 * The verdict tool as `@langwatch/scenario` 1.8.1's judge sends it for the three criteria below,
 * keys renamed to the call's; apps/scenario-child's judge-preview client test pins it to the SDK.
 */
const FINISH_TEST: InstantEvalScenarioJudgeTool = finishTestTool;

type FinishTestStatus = "passed" | "failed" | "inconclusive";

const finishTestEntrySchema = z
  .object({ requirement: z.string(), reasoning: z.string(), status: z.enum(STATUSES_OF_FIXTURE) })
  .strict();

/**
 * A finish_test call's arguments in the SDK's shape, one `{ requirement, reasoning, status }`
 * entry per criterion key given; checked against the fixture's entry schema so no test answers
 * in a shape the SDK's tool would refuse.
 */
export function finishTestInput(
  statuses: Readonly<Record<string, FinishTestStatus>>,
  reasoning = "the transcript settles it",
): Record<string, unknown> {
  const criteria = Object.fromEntries(
    Object.entries(statuses).map(([key, status]) => [
      key,
      finishTestEntrySchema.parse({ requirement: `requirement ${key}`, reasoning: "r", status }),
    ]),
  );
  return { criteria, reasoning };
}
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
