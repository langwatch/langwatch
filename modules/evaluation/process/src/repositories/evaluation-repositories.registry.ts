import { defineRepositories } from "@langwatch/kernel";

import { LiveEvaluationRepositories } from "./live/live.evaluation.repositories.ts";
import { MemoryEvaluationRepositories } from "./memory/memory.evaluation.repositories.ts";

export const evaluationRepositories = defineRepositories({
  live: LiveEvaluationRepositories,
  memory: MemoryEvaluationRepositories,
});
