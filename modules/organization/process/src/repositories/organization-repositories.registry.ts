import { defineRepositories } from "@langwatch/process";

import { LiveOrganizationRepositories } from "./live/live.organization.repositories.ts";
import { MemoryOrganizationRepositories } from "./memory/memory.organization.repositories.ts";

/**
 * Live asks the process for the deployment's cipher beside its Prisma client and Redis: the stored
 * S3 settings are sealed and opened by the organization's repositories, in main's row format.
 */
export const organizationRepositories = defineRepositories({
  live: LiveOrganizationRepositories,
  memory: MemoryOrganizationRepositories,
});
