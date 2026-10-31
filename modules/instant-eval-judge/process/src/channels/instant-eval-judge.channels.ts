import type { InstantEvalClassifierChannel } from "./instant-eval-classifier.channel.ts";
import type { InstantEvalDecisionModelChannel } from "./instant-eval-decision-model.channel.ts";
import type { InstantEvalHostedDecisionsChannel } from "./instant-eval-hosted-decisions.channel.ts";
import type { InstantEvalLlmJudgeChannel } from "./instant-eval-llm-judge.channel.ts";

/** Every channel the judge holds; no classifier unless LangWatch Cloud holds the key. */
export interface InstantEvalJudgeChannels {
  readonly classifier: InstantEvalClassifierChannel | undefined;
  /** An organization's own decision model, on any install (ADR-182 decision 7). */
  readonly decisionModels: InstantEvalDecisionModelChannel;
  /** The router's Decisions leg; absent unless LangWatch Cloud holds its key. */
  readonly hostedDecisions: InstantEvalHostedDecisionsChannel | undefined;
  /** The router's LLM legs; a wire whose key is missing skips as not configured. */
  readonly llmJudge: InstantEvalLlmJudgeChannel;
}
