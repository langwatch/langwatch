import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import {
  createNotificationCommandSchema,
  notificationRecentQuerySchema,
  notificationSchema,
  type CreateNotificationCommand,
  type Notification,
  type NotificationRecentQuery,
} from "@langwatch/notification-contract";
import { NotificationRepository } from "../notification.repository";

/** Prisma implementation of the private Notification repository port. */
/**
 * Only the delegates this repository touches, so composition can name the
 * slice it needs instead of the whole generated client.
 */
export type NotificationDatabase = Pick<PrismaClient, "notification">;

export class PrismaNotificationRepository extends NotificationRepository {
  private constructor(private readonly database: NotificationDatabase) {
    super();
  }

  static create(database: NotificationDatabase): PrismaNotificationRepository {
    return new PrismaNotificationRepository(database);
  }

  async listRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]> {
    const query = notificationRecentQuerySchema.parse(input);
    const rows = await this.database.notification.findMany({
      where: {
        organizationId: query.organizationId,
        sentAt: { gte: query.since },
      },
      orderBy: { sentAt: "desc" },
    });

    return rows.map((row) => notificationSchema.parse(row));
  }

  async create(input: CreateNotificationCommand): Promise<Notification> {
    const command = createNotificationCommandSchema.parse(input);
    const row = await this.database.notification.create({
      data: {
        organizationId: command.organizationId,
        projectId: command.projectId,
        metadata: command.metadata as Prisma.InputJsonValue,
        sentAt: command.sentAt,
      },
    });

    return notificationSchema.parse(row);
  }
}
