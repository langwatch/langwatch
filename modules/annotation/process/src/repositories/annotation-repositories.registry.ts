import { defineRepositories } from "@langwatch/kernel";

import { MemoryAnnotationRepositories } from "./memory/memory.annotation.repositories.ts";
import { PostgresAnnotationRepositories } from "./prisma/prisma.annotation.repositories.ts";

export const annotationRepositories = defineRepositories({
  live: PostgresAnnotationRepositories,
  memory: MemoryAnnotationRepositories,
});
