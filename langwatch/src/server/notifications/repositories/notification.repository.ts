import type { PrismaClient, Notification } from "@prisma/client";
import type { CreateNotificationParams } from "../types/notification-repository.types";

/**
 * Repository for notification data access
 * Single Responsibility: Handle all database operations for Notification
 */
export class NotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Find notifications for an organization since a given date
   */
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

  /**
   * Create a new notification record
   */
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

  /**
   * Find a notification by ID
   */
  async findById(id: string): Promise<Notification | null> {
    return this.prisma.notification.findUnique({
      where: { id },
    });
  }
}
