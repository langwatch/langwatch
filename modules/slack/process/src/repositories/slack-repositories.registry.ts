import { defineRepositories } from "@langwatch/kernel";

import { MemorySlackRepositories } from "./memory/memory.slack.repositories.ts";
import { PrismaSlackRepositories } from "./prisma/prisma.slack.repositories.ts";

export const slackRepositories = defineRepositories({
  live: PrismaSlackRepositories,
  memory: MemorySlackRepositories,
});
