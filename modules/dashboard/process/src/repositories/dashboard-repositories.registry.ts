import { defineRepositories } from "@langwatch/process";

import { MemoryDashboardRepositories } from "./memory/memory.dashboard.repositories.ts";
import { PostgresDashboardRepositories } from "./prisma/prisma.dashboard.repositories.ts";

export const dashboardRepositories = defineRepositories({
  live: PostgresDashboardRepositories,
  memory: MemoryDashboardRepositories,
});
