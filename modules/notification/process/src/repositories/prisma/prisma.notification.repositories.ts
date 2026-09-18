import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaNotificationRepository } from "./prisma.notification.repository.ts";

export const PostgresNotificationRepositories = prismaRepositories({
  notifications: PrismaNotificationRepository,
});
