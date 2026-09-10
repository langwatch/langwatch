import { defineRepositories } from "@langwatch/runtime-composition";
import { PostgresAnnotationRepositories } from "./prisma/prisma.annotation.repositories.ts";
import { MemoryAnnotationRepositories } from "./memory/memory.annotation.repositories.ts";

export const annotationRepositories = defineRepositories({
  live: PostgresAnnotationRepositories,
  memory: MemoryAnnotationRepositories,
});
