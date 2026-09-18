import { defineRepositories } from "@langwatch/kernel";

import { LiveAuthRepositories } from "./live/live.auth.repositories.ts";
import { MemoryAuthRepositories } from "./memory/memory.auth.repositories.ts";

/**
 * Which backend the process selected. The memory twin is not a test fixture:
 * it is what lets the whole sign-in door be booted and exercised without a
 * database, which is how the module's own installation test runs.
 */
export const authRepositories = defineRepositories({
  live: LiveAuthRepositories,
  memory: MemoryAuthRepositories,
});
