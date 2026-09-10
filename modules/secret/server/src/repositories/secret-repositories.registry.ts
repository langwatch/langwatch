import { defineRepositories } from "@langwatch/runtime-composition";
import { MemorySecretRepositories } from "./memory/memory.secret.repositories.ts";
import { PostgresSecretRepositories } from "./prisma/prisma.secret.repositories.ts";

export const secretRepositories = defineRepositories({
  live: PostgresSecretRepositories,
  memory: MemorySecretRepositories,
});
