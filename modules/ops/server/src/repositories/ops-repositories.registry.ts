import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryOpsRepositories } from "./memory/memory.ops.repositories.ts";
import { PostgresOpsRepositories } from "./prisma/prisma.ops.repositories.ts";

export const opsRepositories = defineRepositories({
  live: PostgresOpsRepositories,
  memory: MemoryOpsRepositories,
});
