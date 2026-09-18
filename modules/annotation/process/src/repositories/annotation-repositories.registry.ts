import { defineRepositories } from "@langwatch/kernel";
import { PostgresAnnotationRepositories } from "./prisma/prisma.annotation.repositories.ts";
import { MemoryAnnotationRepositories } from "./memory/memory.annotation.repositories.ts";

export const annotationRepositories = defineRepositories({
  live: PostgresAnnotationRepositories,
  memory: MemoryAnnotationRepositories,
});
