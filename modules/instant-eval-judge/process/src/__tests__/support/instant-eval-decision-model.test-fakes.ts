import type {
  InstantEvalDecisionModelAnswer,
  InstantEvalDecisionModelChannel,
  InstantEvalDecisionModelRequest,
} from "../../channels/instant-eval-decision-model.channel.ts";

/** A decision model channel that answers as scripted and keeps every request it was sent. */
export class ScriptedInstantEvalDecisionModelChannel implements InstantEvalDecisionModelChannel {
  readonly requests: InstantEvalDecisionModelRequest[] = [];

  private constructor(
    private readonly answer: (
      request: InstantEvalDecisionModelRequest,
    ) => InstantEvalDecisionModelAnswer,
  ) {}

  static create({
    answer,
  }: {
    answer: (request: InstantEvalDecisionModelRequest) => InstantEvalDecisionModelAnswer;
  }): ScriptedInstantEvalDecisionModelChannel {
    return new ScriptedInstantEvalDecisionModelChannel(answer);
  }

  async classify(
    request: InstantEvalDecisionModelRequest,
  ): Promise<InstantEvalDecisionModelAnswer> {
    this.requests.push(request);
    return this.answer(request);
  }
}
