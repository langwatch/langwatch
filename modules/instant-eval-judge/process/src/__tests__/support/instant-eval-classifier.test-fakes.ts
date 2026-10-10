import type { InstantEvalJudgement } from "@langwatch/instant-eval-judge-contract";

import type {
  InstantEvalClassifierChannel,
  InstantEvalClassifyRequest,
} from "../../channels/instant-eval-classifier.channel.ts";

type InstantEvalClassifierAnswer = (
  request: InstantEvalClassifyRequest,
  signal?: AbortSignal,
) => Promise<InstantEvalJudgement>;

/** The cloud classifier's twin: answers each request as scripted, never over the network. */
export class MemoryInstantEvalClassifierChannel implements InstantEvalClassifierChannel {
  private constructor(private readonly answer: InstantEvalClassifierAnswer) {}

  static create({
    answer,
  }: {
    answer: InstantEvalClassifierAnswer;
  }): MemoryInstantEvalClassifierChannel {
    return new MemoryInstantEvalClassifierChannel(answer);
  }

  classify(
    request: InstantEvalClassifyRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement> {
    return this.answer(request, signal);
  }
}
