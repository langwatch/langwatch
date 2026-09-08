import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryEvaluatorRepositories } from "./memory/memory.evaluator.repositories.ts";
import { PostgresEvaluatorRepositories } from "./prisma/prisma.evaluator.repositories.ts";

export const evaluatorRepositories = defineRepositories({
  postgres: PostgresEvaluatorRepositories,
  memory: MemoryEvaluatorRepositories,
});
