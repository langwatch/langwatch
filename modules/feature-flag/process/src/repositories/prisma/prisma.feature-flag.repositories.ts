import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaFeatureFlagExperimentSettingRepository } from "./prisma.feature-flag-experiment-setting.repository.ts";
import { PrismaFeatureFlagRepository } from "./prisma.feature-flag.repository.ts";

export const PostgresFeatureFlagRepositories = prismaRepositories({
  flags: PrismaFeatureFlagRepository,
  experiments: PrismaFeatureFlagExperimentSettingRepository,
});
