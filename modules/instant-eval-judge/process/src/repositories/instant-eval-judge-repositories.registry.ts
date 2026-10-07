import { defineRepositories } from "@langwatch/process";

import { LiveInstantEvalJudgeRepositories } from "./live/live.instant-eval-judge.repositories.ts";
import { MemoryInstantEvalJudgeRepositories } from "./memory/memory.instant-eval-judge.repositories.ts";

export const instantEvalJudgeRepositories = defineRepositories({
  live: LiveInstantEvalJudgeRepositories,
  memory: MemoryInstantEvalJudgeRepositories,
});
