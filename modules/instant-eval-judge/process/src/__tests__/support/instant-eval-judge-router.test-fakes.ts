import type { InstantEvalJudgement } from "@langwatch/instant-eval-judge-contract";

import type {
  InstantEvalHostedDecisionsChannel,
  InstantEvalHostedDecisionsRequest,
} from "../../channels/instant-eval-hosted-decisions.channel.ts";
import type {
  InstantEvalLlmJudgeAnswer,
  InstantEvalLlmJudgeChannel,
  InstantEvalLlmJudgeRequest,
} from "../../channels/instant-eval-llm-judge.channel.ts";

/** The hosted Decisions leg's twin: answers as scripted, or throws what it is given. */
export class ScriptedInstantEvalHostedDecisionsChannel implements InstantEvalHostedDecisionsChannel {
  readonly requests: InstantEvalHostedDecisionsRequest[] = [];

  private constructor(
    private readonly answer: (request: InstantEvalHostedDecisionsRequest) => InstantEvalJudgement,
  ) {}

  static create({
    answer,
  }: {
    answer: (request: InstantEvalHostedDecisionsRequest) => InstantEvalJudgement;
  }): ScriptedInstantEvalHostedDecisionsChannel {
    return new ScriptedInstantEvalHostedDecisionsChannel(answer);
  }

  async classify(request: InstantEvalHostedDecisionsRequest): Promise<InstantEvalJudgement> {
    this.requests.push(request);
    return this.answer(request);
  }
}

/** The LLM legs' twin: answers each question as scripted and keeps every request. */
export class ScriptedInstantEvalLlmJudgeChannel implements InstantEvalLlmJudgeChannel {
  readonly requests: InstantEvalLlmJudgeRequest[] = [];

  private constructor(
    private readonly answer: (request: InstantEvalLlmJudgeRequest) => InstantEvalLlmJudgeAnswer,
  ) {}

  static create({
    answer,
  }: {
    answer: (request: InstantEvalLlmJudgeRequest) => InstantEvalLlmJudgeAnswer;
  }): ScriptedInstantEvalLlmJudgeChannel {
    return new ScriptedInstantEvalLlmJudgeChannel(answer);
  }

  async judge(request: InstantEvalLlmJudgeRequest): Promise<InstantEvalLlmJudgeAnswer> {
    this.requests.push(request);
    return this.answer(request);
  }
}
