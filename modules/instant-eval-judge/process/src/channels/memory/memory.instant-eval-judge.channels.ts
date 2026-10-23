import type { InstantEvalJudgeChannels } from "../instant-eval-judge.channels.ts";
import type {
  InstantEvalLlmJudgeAnswer,
  InstantEvalLlmJudgeChannel,
} from "../instant-eval-llm-judge.channel.ts";
import { MemoryInstantEvalDecisionModelChannel } from "./memory.instant-eval-decision-model.channel.ts";

/** No classifier: memory-tier processes judge nothing, as before the registry. */
export class MemoryInstantEvalJudgeChannels {
  static readonly requires = [] as const;

  static create(): InstantEvalJudgeChannels {
    return {
      classifier: undefined,
      decisionModels: MemoryInstantEvalDecisionModelChannel.create(),
      hostedDecisions: undefined,
      llmJudge: unavailableLlmJudge,
    };
  }
}

/** No provider is reached in the memory tier, so every LLM leg is unavailable. */
const unavailableLlmJudge: InstantEvalLlmJudgeChannel = {
  isConfigured: () => false,
  judge: async (): Promise<InstantEvalLlmJudgeAnswer> => ({
    outcome: "skipped",
    reason: "classifier_provider_unavailable",
    inputTokens: 0,
    outputTokens: 0,
  }),
};
