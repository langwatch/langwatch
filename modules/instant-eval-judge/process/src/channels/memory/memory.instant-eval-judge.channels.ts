import type { InstantEvalJudgeChannels } from "../instant-eval-judge.channels.ts";
import { MemoryInstantEvalDecisionModelChannel } from "./memory.instant-eval-decision-model.channel.ts";
import { MemoryInstantEvalLlmJudgeChannel } from "./memory.instant-eval-llm-judge.channel.ts";

/** No classifier: memory-tier processes judge nothing, as before the registry. */
export class MemoryInstantEvalJudgeChannels {
  static readonly requires = [] as const;

  static create(): InstantEvalJudgeChannels {
    return {
      classifier: undefined,
      decisionModels: MemoryInstantEvalDecisionModelChannel.create(),
      hostedDecisions: undefined,
      llmJudge: MemoryInstantEvalLlmJudgeChannel.create(),
    };
  }
}
