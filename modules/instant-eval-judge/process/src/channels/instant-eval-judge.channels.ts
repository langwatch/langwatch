import type { InstantEvalClassifierChannel } from "./instant-eval-classifier.channel.ts";

/** Every channel the judge holds; no classifier unless LangWatch Cloud holds the key. */
export interface InstantEvalJudgeChannels {
  readonly classifier: InstantEvalClassifierChannel | undefined;
}
