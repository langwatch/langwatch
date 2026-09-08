import { defineRepositories } from "@langwatch/runtime-composition";

import { MemoryEvaluationRepositories } from "./memory/memory.evaluation.repositories.ts";
import { PostgresEvaluationRepositories } from "./prisma/prisma.evaluation.repositories.ts";

export const evaluationRepositories = defineRepositories({
  postgres: PostgresEvaluationRepositories,
  memory: MemoryEvaluationRepositories,
});
