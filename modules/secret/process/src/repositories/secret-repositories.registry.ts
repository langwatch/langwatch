import { defineRepositories } from "@langwatch/kernel";

import { LiveSecretRepositories } from "./live/live.secret.repositories.ts";
import { MemorySecretRepositories } from "./memory/memory.secret.repositories.ts";

export const secretRepositories = defineRepositories({
  live: LiveSecretRepositories,
  memory: MemorySecretRepositories,
});
