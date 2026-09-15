import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryFeatureFlagRepositories } from "./memory/memory.feature-flag.repositories.ts";
import { PostgresFeatureFlagRepositories } from "./prisma/prisma.feature-flag.repositories.ts";

export const featureFlagRepositories = defineRepositories({
  live: PostgresFeatureFlagRepositories,
  memory: MemoryFeatureFlagRepositories,
});
