import type { Prisma } from "@prisma/client";

/**
 * Derives create params from Prisma schema, omitting auto-generated fields
 */
export type CreateNotificationParams = Omit<
  Prisma.NotificationUncheckedCreateInput,
  "id" | "createdAt" | "updatedAt"
>;

