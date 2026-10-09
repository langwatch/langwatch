import type { InstantEvalJudgeChannels } from "../instant-eval-judge.channels.ts";

/** No classifier: memory-tier processes judge nothing, as before the registry. */
export class MemoryInstantEvalJudgeChannels {
  static readonly requires = [] as const;

  static create(): InstantEvalJudgeChannels {
    return { classifier: undefined };
  }
}
