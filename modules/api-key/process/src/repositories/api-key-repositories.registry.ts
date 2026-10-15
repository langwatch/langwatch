import { defineRepositories } from "@langwatch/process";

import { LiveApiKeyRepositories } from "./live/live.api-key.repositories.ts";
import { MemoryApiKeyRepositories } from "./memory/memory.api-key.repositories.ts";

/** Which backing the API-key aggregate is read through, chosen once at boot. */
export const apiKeyRepositories = defineRepositories({
  live: LiveApiKeyRepositories,
  memory: MemoryApiKeyRepositories,
});
