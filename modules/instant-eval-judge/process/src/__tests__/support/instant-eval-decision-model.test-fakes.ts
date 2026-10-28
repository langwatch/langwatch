import type { InstantEvalJudgement } from "@langwatch/instant-eval-judge-contract";

import type {
  InstantEvalDecisionModelChannel,
  InstantEvalDecisionModelRequest,
} from "../../channels/instant-eval-decision-model.channel.ts";

/** A decision model channel that answers as scripted and keeps every request it was sent. */
export class ScriptedInstantEvalDecisionModelChannel implements InstantEvalDecisionModelChannel {
  readonly requests: InstantEvalDecisionModelRequest[] = [];

  private constructor(
    private readonly answer: (request: InstantEvalDecisionModelRequest) => InstantEvalJudgement,
  ) {}

  static create({
    answer,
  }: {
    answer: (request: InstantEvalDecisionModelRequest) => InstantEvalJudgement;
  }): ScriptedInstantEvalDecisionModelChannel {
    return new ScriptedInstantEvalDecisionModelChannel(answer);
  }

  async classify(request: InstantEvalDecisionModelRequest): Promise<InstantEvalJudgement> {
    this.requests.push(request);
    return this.answer(request);
  }
}
