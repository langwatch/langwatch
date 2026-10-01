import { defineRepositories } from "@langwatch/kernel";

import { MemoryOrganizationRepositories } from "./memory/memory.organization.repositories.ts";
import { PostgresOrganizationRepositories } from "./prisma/prisma.organization.repositories.ts";

export const organizationRepositories = defineRepositories({
  live: PostgresOrganizationRepositories,
  memory: MemoryOrganizationRepositories,
});
