import { defineRepositories } from "@langwatch/process";

import { MemoryInstantEvalJudgeRepositories } from "./memory/memory.instant-eval-judge.repositories.ts";
import { PostgresInstantEvalJudgeRepositories } from "./prisma/prisma.instant-eval-judge.repositories.ts";

export const instantEvalJudgeRepositories = defineRepositories({
  live: PostgresInstantEvalJudgeRepositories,
  memory: MemoryInstantEvalJudgeRepositories,
});
