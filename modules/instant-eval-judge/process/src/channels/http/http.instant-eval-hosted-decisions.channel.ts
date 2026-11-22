import type { InstantEvalJudgement } from "@langwatch/instant-eval-judge-contract";
import type { Dispatcher } from "undici";

import type { InstantEvalDecisionModelChannel } from "../instant-eval-decision-model.channel.ts";
import type {
  InstantEvalHostedDecisionsChannel,
  InstantEvalHostedDecisionsRequest,
} from "../instant-eval-hosted-decisions.channel.ts";
import { HttpInstantEvalDecisionModelChannel } from "./http.instant-eval-decision-model.channel.ts";

const DECISIONS_ENDPOINT = "https://api.openai.com/v1/decisions";

/**
 * The own decision model channel, held with LangWatch's key and its billed tokens kept. One send
 * per call, never a retry: the router takes one limiter permit per call, so a retry here would
 * send past its pacing on the shared key exactly while the provider is overloaded.
 */
export class HttpInstantEvalHostedDecisionsChannel implements InstantEvalHostedDecisionsChannel {
  private constructor(
    private readonly decisionModels: InstantEvalDecisionModelChannel,
    private readonly apiKey: string,
  ) {}

  /** `dispatcher` is a suite's stand-in for the socket; undici's global pool otherwise. */
  static create({
    apiKey,
    dispatcher,
  }: {
    apiKey: string;
    dispatcher?: Dispatcher;
  }): HttpInstantEvalHostedDecisionsChannel {
    const decisionModels = HttpInstantEvalDecisionModelChannel.create({
      maxAttempts: 1,
      ...(dispatcher ? { dispatcher } : {}),
    });
    return new HttpInstantEvalHostedDecisionsChannel(decisionModels, apiKey);
  }

  classify(
    { text, questions, model }: InstantEvalHostedDecisionsRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement> {
    return this.decisionModels.classify(
      {
        text,
        questions,
        isBilledToLangWatch: true,
        decisionModel: {
          model: `openai/decisions:${model}`,
          wire: "openai_decisions",
          providerModel: model,
          endpoint: DECISIONS_ENDPOINT,
          apiKey: this.apiKey,
        },
      },
      ...(signal ? [signal] : []),
    );
  }
}
