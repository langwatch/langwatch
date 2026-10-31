/**
 * The router's hosted Decisions leg: OpenAI's Decisions API on LangWatch's key, over the own
 * decision model channel's wire. It skips, never throws, for a provider failure.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type {
  InstantEvalJudgement,
  InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";
import { Secret } from "@langwatch/secrets";

/** LangWatch's Decisions API key for the router; read on LangWatch Cloud only. */
export const hostedDecisionsApiKey = Secret.load("INSTANT_EVAL_DECISIONS_API_KEY", {
  optional: true,
});

export interface InstantEvalHostedDecisionsRequest {
  readonly text: string;
  readonly questions: readonly InstantEvalQuestion[];
  /** The provider's model id, from the route table; there is no default. */
  readonly model: string;
}

export interface InstantEvalHostedDecisionsChannel {
  classify(
    request: InstantEvalHostedDecisionsRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement>;
}
