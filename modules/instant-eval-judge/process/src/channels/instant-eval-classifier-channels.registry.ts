import { HttpInstantEvalClassifierChannel } from "./http/http.instant-eval-classifier.channel.ts";
import { MemoryInstantEvalClassifierChannel } from "./memory/memory.instant-eval-classifier.channel.ts";

/** Where the judge's classify calls go: LangWatch's cloud classifier, or its scripted twin. */
export const instantEvalClassifierChannels = {
  live: HttpInstantEvalClassifierChannel,
  memory: MemoryInstantEvalClassifierChannel,
};
