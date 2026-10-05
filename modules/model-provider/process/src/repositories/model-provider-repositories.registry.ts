import { defineRepositories } from "@langwatch/process";

import { LiveModelProviderRepositories } from "./live/live.model-provider.repositories.ts";
import { MemoryModelProviderRepositories } from "./memory/memory.model-provider.repositories.ts";

/**
 * Live asks the process for the deployment's cipher beside its Prisma client and Redis: a stored
 * credential is sealed and opened by the provider store, and the row format is shared by processes.
 */
export const modelProviderRepositories = defineRepositories({
  live: LiveModelProviderRepositories,
  memory: MemoryModelProviderRepositories,
});
