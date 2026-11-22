import { defineChannels } from "@langwatch/process";

import { HttpInstantEvalJudgeChannels } from "./http/http.instant-eval-judge.channels.ts";
import { MemoryInstantEvalJudgeChannels } from "./memory/memory.instant-eval-judge.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const instantEvalJudgeChannels = defineChannels({
  live: HttpInstantEvalJudgeChannels,
  memory: MemoryInstantEvalJudgeChannels,
});
