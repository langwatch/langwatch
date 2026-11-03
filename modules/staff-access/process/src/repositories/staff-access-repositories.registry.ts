import { defineRepositories } from "@langwatch/process";

import { MemoryStaffAccessRepositories } from "./memory/memory.staff-access.repositories.ts";
import { PostgresStaffAccessRepositories } from "./prisma/prisma.staff-access.repositories.ts";

export const staffAccessRepositories = defineRepositories({
  live: PostgresStaffAccessRepositories,
  memory: MemoryStaffAccessRepositories,
});
