import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryShareRepositories } from "./memory/memory.share.repositories.ts";
import { PostgresShareRepositories } from "./prisma/prisma.share.repositories.ts";

export const shareRepositories = defineRepositories({
  live: PostgresShareRepositories,
  memory: MemoryShareRepositories,
});
