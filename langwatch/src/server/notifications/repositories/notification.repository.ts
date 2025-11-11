import type { PrismaClient, Prisma, Notification } from "@prisma/client";

/**
 * Derives create params from Prisma schema, omitting auto-generated fields
 */
export type CreateNotificationParams = Omit<
  Prisma.NotificationUncheckedCreateInput,
  "id" | "createdAt" | "updatedAt"
>;

/**
 * Repository for notification data access
 * Single Responsibility: Handle all database operations for Notification
 */
export class NotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findRecentByOrganization(
    organizationId: string,
    since: Date,
  ): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: {
        organizationId,
        sentAt: {
          gte: since,
        },
      },
      orderBy: {
        sentAt: "desc",
      },
    });
  }

  async create(params: CreateNotificationParams): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        metadata: params.metadata,
        sentAt: params.sentAt,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.notification.findUnique({
      where: { id },
    });
  }
}
