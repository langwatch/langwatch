import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryNotificationRepositories } from "./memory/memory.notification.repositories.ts";
import { PostgresNotificationRepositories } from "./prisma/prisma.notification.repositories.ts";

export const notificationRepositories = defineRepositories({
  postgres: PostgresNotificationRepositories,
  memory: MemoryNotificationRepositories,
});
