import {
  instantEvalJudgeRouteTableSchema,
  type InstantEvalBooleanQuestion,
  type InstantEvalJudgeRouteTable,
} from "@langwatch/instant-eval-judge-contract";

/** A synthetic route table shaped like a real one; its picks are made up, not measured. */
export function syntheticRouteTable(
  overrides: { backends?: Record<string, unknown>; inputViews?: unknown } = {},
): InstantEvalJudgeRouteTable {
  const pairShort = {
    instant: { primary: "decisions", pairWith: "jev" },
    balanced: { primary: "decisions", escalateTo: "haiku", threshold: 0.7 },
    accurate: { primary: "haiku" },
  };
  return instantEvalJudgeRouteTableSchema.parse({
    version: 1,
    defaultMode: { search: "balanced", llm_judge: "balanced", scenario_judge: "balanced" },
    buckets: [
      { name: "<=2k", maxTokens: 2000 },
      { name: "2k-8k", maxTokens: 8000 },
      { name: ">8k", maxTokens: null },
    ],
    arithmetic: {
      maxTokens: 8000,
      source: { search: "request_then_regex", llm_judge: "regex", scenario_judge: "request" },
    },
    inputViews: { default: "full", byCategory: { sentiment: "text", tool_args: "full" } },
    backends: {
      decisions: { kind: "decisions", fallbacks: ["jev"] },
      jev: { kind: "jev" },
      haiku: { kind: "anthropic_messages" },
      luna: { kind: "openai_responses" },
      ...overrides.backends,
    },
    routes: {
      search: {
        "<=2k": pairShort,
        "2k-8k": { instant: { primary: "decisions", pairWith: "jev" } },
        ">8k": { instant: { primary: "decisions" }, balanced: { primary: "luna" } },
        arithmetic: { instant: { primary: "decisions" }, balanced: { primary: "haiku" } },
      },
      llm_judge: {
        "<=2k": pairShort,
        "2k-8k": pairShort,
        ">8k": {
          instant: { primary: "decisions" },
          balanced: { primary: "decisions", escalateTo: "luna", threshold: 0.7 },
        },
        arithmetic: { instant: { primary: "decisions" }, balanced: { primary: "luna" } },
      },
      scenario_judge: {
        "<=2k": { instant: { primary: "decisions" } },
        "2k-8k": { instant: { primary: "decisions" } },
        ">8k": { instant: { primary: "jev" } },
        arithmetic: { instant: { primary: "jev" } },
      },
    },
    ...(overrides.inputViews ? { inputViews: overrides.inputViews } : {}),
  });
}

export function yesNo(id: string, instructions: string): InstantEvalBooleanQuestion {
  return { id, kind: "boolean", instructions };
}
