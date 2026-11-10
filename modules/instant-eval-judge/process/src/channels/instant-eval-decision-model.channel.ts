/**
 * An organization's own decision model, called with its own key (ADR-182 decision 8). It never
 * throws for a provider failure: each one is a skip naming its reason, so a broken key never
 * refuses a whole query and never falls back to LangWatch's classifier.
 */

import type {
  InstantEvalJudgement,
  InstantEvalOwnDecisionModel,
  InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";

export interface InstantEvalDecisionModelRequest {
  readonly text: string;
  readonly questions: readonly InstantEvalQuestion[];
  readonly decisionModel: InstantEvalOwnDecisionModel;
  /** LangWatch's own key (the router's hosted leg): the provider's input tokens are kept. */
  readonly isBilledToLangWatch?: boolean;
}

/**
 * A judgement plus, on the organization's own key, the tokens the provider billed it for. They
 * never price the judgement; they go to the spend ledger (ADR-193).
 */
export type InstantEvalDecisionModelAnswer = InstantEvalJudgement & {
  readonly providerUsage?: Readonly<{ inputTokens: number; outputTokens: number }>;
};

export interface InstantEvalDecisionModelChannel {
  classify(
    request: InstantEvalDecisionModelRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalDecisionModelAnswer>;
}
