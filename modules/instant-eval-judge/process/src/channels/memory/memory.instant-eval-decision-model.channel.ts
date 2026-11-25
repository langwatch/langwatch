import {
  instantEvalSkipped,
  type InstantEvalJudgement,
} from "@langwatch/instant-eval-judge-contract";

import type { InstantEvalDecisionModelChannel } from "../instant-eval-decision-model.channel.ts";

/** No provider is reached in the memory tier, so every own-model call is unavailable. */
export class MemoryInstantEvalDecisionModelChannel implements InstantEvalDecisionModelChannel {
  private constructor() {}

  static create(): MemoryInstantEvalDecisionModelChannel {
    return new MemoryInstantEvalDecisionModelChannel();
  }

  async classify(): Promise<InstantEvalJudgement> {
    return instantEvalSkipped("classifier_provider_unavailable");
  }
}
