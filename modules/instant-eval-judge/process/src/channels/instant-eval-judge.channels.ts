import type { InstantEvalClassifierChannel } from "./instant-eval-classifier.channel.ts";
import type { InstantEvalDecisionModelChannel } from "./instant-eval-decision-model.channel.ts";

/** Every channel the judge holds; no classifier unless LangWatch Cloud holds the key. */
export interface InstantEvalJudgeChannels {
  readonly classifier: InstantEvalClassifierChannel | undefined;
  /** An organization's own decision model, on any install (ADR-182 decision 7). */
  readonly decisionModels: InstantEvalDecisionModelChannel;
}
