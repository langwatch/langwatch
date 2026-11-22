import { defineRepositories } from "@langwatch/process";

import { MemoryDataPrivacyRepositories } from "./memory/memory.data-privacy.repositories.ts";
import { PostgresDataPrivacyRepositories } from "./prisma/prisma.data-privacy.repositories.ts";

export const dataPrivacyRepositories = defineRepositories({
  live: PostgresDataPrivacyRepositories,
  memory: MemoryDataPrivacyRepositories,
});
