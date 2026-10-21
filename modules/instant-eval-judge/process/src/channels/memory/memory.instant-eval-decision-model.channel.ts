import {
  instantEvalSkipped,
  type InstantEvalJudgement,
} from "@langwatch/instant-eval-judge-contract";

import type {
  InstantEvalDecisionModelChannel,
  InstantEvalDecisionModelRequest,
} from "../instant-eval-decision-model.channel.ts";

/** No provider is reached in the memory tier, so every own-model call is unavailable. */
export class MemoryInstantEvalDecisionModelChannel implements InstantEvalDecisionModelChannel {
  readonly requests: InstantEvalDecisionModelRequest[] = [];

  private constructor(
    private readonly answer: (request: InstantEvalDecisionModelRequest) => InstantEvalJudgement,
  ) {}

  static create({
    answer = () => instantEvalSkipped("classifier_provider_unavailable"),
  }: {
    answer?: (request: InstantEvalDecisionModelRequest) => InstantEvalJudgement;
  } = {}): MemoryInstantEvalDecisionModelChannel {
    return new MemoryInstantEvalDecisionModelChannel(answer);
  }

  async classify(request: InstantEvalDecisionModelRequest): Promise<InstantEvalJudgement> {
    this.requests.push(request);
    return this.answer(request);
  }
}
