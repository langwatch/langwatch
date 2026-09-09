import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaAnnotationRepository } from "./prisma.annotation.repository.ts";
import { PrismaAnnotationScoreRepository } from "./prisma.annotation-score.repository.ts";
import { PrismaAnnotationQueueRepository } from "./prisma.annotation-queue.repository.ts";
import { PrismaAnnotationQueueItemRepository } from "./prisma.annotation-queue-item.repository.ts";

export const PostgresAnnotationRepositories = prismaRepositories({
  annotations: PrismaAnnotationRepository,
  scores: PrismaAnnotationScoreRepository,
  queues: PrismaAnnotationQueueRepository,
  queueItems: PrismaAnnotationQueueItemRepository,
});
