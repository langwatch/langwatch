import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaDataPrivacyPolicyRepository } from "./prisma.data-privacy.repository.ts";

export const PostgresDataPrivacyRepositories = prismaRepositories({
  policies: PrismaDataPrivacyPolicyRepository,
});
