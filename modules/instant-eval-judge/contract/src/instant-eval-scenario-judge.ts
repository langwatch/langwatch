/**
 * One scenario judge call as the leaf takes it: the criteria the scenario judge was asked about,
 * the judge's own call for a leg that reads it whole, and what comes back per criterion.
 * @see modules/instant-eval-judge/specs/instant-eval-scenario-judge.feature
 */

import type { InstantEvalJudgeRefusalCode } from "./instant-eval-judge.api.ts";

/** The spend model a scenario judgement is recorded under; never a backend's name. */
export const INSTANT_EVAL_SCENARIO_JUDGE_SPEND_MODEL = "langwatch-judge-preview";

/** The tool the scenario judge answers its verdict with, and the two its turn decision uses. */
export const INSTANT_EVAL_SCENARIO_VERDICT_TOOL = "finish_test";
export const INSTANT_EVAL_SCENARIO_DECISION_TOOLS = {
  continue: "continue_test",
  verdict: "make_verdict",
} as const;

/** `verdict`: every criterion is judged. `decision`: whether the conversation goes on. */
export type InstantEvalScenarioJudgePhase = "verdict" | "decision";

export type InstantEvalScenarioCriterionResult = "met" | "unmet" | "inconclusive";

export interface InstantEvalScenarioJudgeTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** One scenario judge call: cloud only, unknown project, budget, judge, one priced fact. */
export interface InstantEvalScenarioJudgeCall {
  readonly projectId: string;
  readonly phase: InstantEvalScenarioJudgePhase;
  /** The scenario's description. */
  readonly description: string;
  /** The judge's user message: transcript, trace digest, any additional context. */
  readonly content: string;
  /** Verdict phase: each criterion with the key the judge's tool names it by, in its order. */
  readonly criteria: readonly Readonly<{ key: string; text: string }>[];
  /** The judge's own call, sent as it is to a leg that reads it whole. */
  readonly llmCall: Readonly<{
    system: string;
    user: string;
    tools: readonly InstantEvalScenarioJudgeTool[];
  }>;
  /** The call's retry key: the same key gives the same spend id. */
  readonly requestKey?: string;
  readonly signal?: AbortSignal;
}

export type InstantEvalScenarioJudgeAnswer =
  | Readonly<{
      outcome: "judged";
      phase: "verdict";
      /** One per criterion asked, in the order asked. */
      criteria: readonly Readonly<{ key: string; result: InstantEvalScenarioCriterionResult }>[];
      /** The explanation of a leg that read the whole call, when one answered. */
      reasoning?: string;
      inputTokens: number;
      priceUsd: number;
    }>
  | Readonly<{
      outcome: "judged";
      phase: "decision";
      decision: "continue" | "verdict";
      inputTokens: number;
      priceUsd: number;
    }>
  | Readonly<{ outcome: "refused"; code: InstantEvalJudgeRefusalCode; message: string }>
  /** No leg answered anything; the caller reports an error, never a verdict. */
  | Readonly<{ outcome: "unavailable" }>;
