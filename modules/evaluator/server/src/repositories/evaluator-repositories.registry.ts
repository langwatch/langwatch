/**
 * Which backing store this module's one table is read on, chosen once at boot.
 * The memory twin answers the same questions as the Prisma one, so the app can
 * be driven without a database.
 */
import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryEvaluatorRepositories } from "./memory/memory.evaluator.repositories.ts";
import { PostgresEvaluatorRepositories } from "./prisma/prisma.evaluator.repositories.ts";

export const evaluatorRepositories = defineRepositories({
  postgres: PostgresEvaluatorRepositories,
  memory: MemoryEvaluatorRepositories,
});
