import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaTopicRepository } from "./prisma.topic.repository.ts";

export const PostgresTopicRepositories = prismaRepositories({
  topics: PrismaTopicRepository,
});
