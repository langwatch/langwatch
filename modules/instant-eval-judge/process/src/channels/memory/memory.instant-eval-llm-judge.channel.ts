import type {
  InstantEvalLlmJudgeAnswer,
  InstantEvalLlmJudgeChannel,
} from "../instant-eval-llm-judge.channel.ts";

/** No provider is reached in the memory tier, so every LLM leg is unavailable. */
export class MemoryInstantEvalLlmJudgeChannel implements InstantEvalLlmJudgeChannel {
  private constructor() {}

  static create(): MemoryInstantEvalLlmJudgeChannel {
    return new MemoryInstantEvalLlmJudgeChannel();
  }

  async judge(): Promise<InstantEvalLlmJudgeAnswer> {
    return {
      outcome: "skipped",
      reason: "classifier_provider_unavailable",
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}
