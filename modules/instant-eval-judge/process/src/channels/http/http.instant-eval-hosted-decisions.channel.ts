import type { InstantEvalJudgement } from "@langwatch/instant-eval-judge-contract";

import type { InstantEvalDecisionModelChannel } from "../instant-eval-decision-model.channel.ts";
import type {
  InstantEvalHostedDecisionsChannel,
  InstantEvalHostedDecisionsRequest,
} from "../instant-eval-hosted-decisions.channel.ts";

const DECISIONS_ENDPOINT = "https://api.openai.com/v1/decisions";
const DECISIONS_DEFAULT_MODEL = "gpt-6-luna";

/** The own decision model channel, held with LangWatch's key and the input tokens kept. */
export class HttpInstantEvalHostedDecisionsChannel implements InstantEvalHostedDecisionsChannel {
  private constructor(
    private readonly decisionModels: InstantEvalDecisionModelChannel,
    private readonly apiKey: string,
  ) {}

  static create({
    decisionModels,
    apiKey,
  }: {
    decisionModels: InstantEvalDecisionModelChannel;
    apiKey: string;
  }): HttpInstantEvalHostedDecisionsChannel {
    return new HttpInstantEvalHostedDecisionsChannel(decisionModels, apiKey);
  }

  classify(
    { text, questions, model = DECISIONS_DEFAULT_MODEL }: InstantEvalHostedDecisionsRequest,
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
