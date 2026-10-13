import { defineChannels } from "@langwatch/process";

import { HttpEvaluationChannels } from "./http/http.evaluation.channels.ts";
import { MemoryEvaluationChannels } from "./memory/memory.evaluation.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const evaluationChannels = defineChannels({
  live: HttpEvaluationChannels,
  memory: MemoryEvaluationChannels,
});
