import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryDataPrivacyRepositories } from "./memory/memory.data-privacy.repositories.ts";
import { PostgresDataPrivacyRepositories } from "./prisma/prisma.data-privacy.repositories.ts";

export const dataPrivacyRepositories = defineRepositories({
  postgres: PostgresDataPrivacyRepositories,
  memory: MemoryDataPrivacyRepositories,
});
