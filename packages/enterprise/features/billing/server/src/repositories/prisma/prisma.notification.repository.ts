import type {
  Prisma,
  PrismaClient,
} from "@langwatch/prisma-client/generated";
import {
  NotificationRepository,
  type BillingNotification,
  type CreateNotificationParams,
} from "../../ports/notification.port";

/**
 * Repository for notification data access
 * Single Responsibility: Handle all database operations for Notification
 */
export class PrismaNotificationRepository extends NotificationRepository {
  private constructor(private readonly prisma: PrismaClient) { super(); }

  static create(database: object): PrismaNotificationRepository {
    return new PrismaNotificationRepository(database as PrismaClient);
  }

  async findRecentByOrganization(
    organizationId: string,
    since: Date,
  ): Promise<BillingNotification[]> {
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

  async create(params: CreateNotificationParams): Promise<BillingNotification> {
    return this.prisma.notification.create({
      data: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        metadata: params.metadata as Prisma.InputJsonValue,
        sentAt: params.sentAt,
      },
    });
  }

  async findById(id: string): Promise<BillingNotification | null> {
    return this.prisma.notification.findUnique({
      where: { id },
    });
  }
}
