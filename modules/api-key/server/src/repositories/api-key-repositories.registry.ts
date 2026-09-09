import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryApiKeyRepositories } from "./memory/memory.api-key.repositories.ts";
import { PostgresApiKeyRepositories } from "./prisma/prisma.api-key.repositories.ts";

/** Which backing the API-key aggregate is read through, chosen once at boot. */
export const apiKeyRepositories = defineRepositories({
  postgres: PostgresApiKeyRepositories,
  memory: MemoryApiKeyRepositories,
});
