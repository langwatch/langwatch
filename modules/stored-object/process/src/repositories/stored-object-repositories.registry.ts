import { defineRepositories } from "@langwatch/kernel";
import { MemoryStoredObjectRepositories } from "./memory/memory.stored-object.repositories.ts";
import { PostgresStoredObjectRepositories } from "./prisma/prisma.stored-object.repositories.ts";

export const storedObjectRepositories = defineRepositories({
  live: PostgresStoredObjectRepositories,
  memory: MemoryStoredObjectRepositories,
});
