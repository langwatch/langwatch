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

type HostedDecisionsAnswer = (
  request: InstantEvalHostedDecisionsRequest,
  signal?: AbortSignal,
) => InstantEvalJudgement | Promise<InstantEvalJudgement>;

/** The hosted Decisions leg's twin: answers as scripted, or throws what it is given. */
export class ScriptedInstantEvalHostedDecisionsChannel implements InstantEvalHostedDecisionsChannel {
  readonly requests: InstantEvalHostedDecisionsRequest[] = [];

  private constructor(private readonly answer: HostedDecisionsAnswer) {}

  static create({
    answer,
  }: {
    answer: HostedDecisionsAnswer;
  }): ScriptedInstantEvalHostedDecisionsChannel {
    return new ScriptedInstantEvalHostedDecisionsChannel(answer);
  }

  async classify(
    request: InstantEvalHostedDecisionsRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement> {
    this.requests.push(request);
    return this.answer(request, signal);
  }
}

/** A provider that never answers: it rejects with the signal's reason once it is aborted. */
export function hangUntilAborted<T>(signal?: AbortSignal): Promise<T> {
  return new Promise<T>((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
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
