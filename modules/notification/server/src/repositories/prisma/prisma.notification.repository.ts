import {
  createNotificationCommandSchema,
  notificationRecentQuerySchema,
  notificationSchema,
  type CreateNotificationCommand,
  type Notification,
  type NotificationRecentQuery,
} from "@langwatch/notification-contract";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { NotificationRepository } from "../notification.repository.ts";

export class PrismaNotificationRepository
  extends PrismaRepository.for("Notification")
  implements NotificationRepository
{
  static readonly create = this.factory((prisma) => new PrismaNotificationRepository(prisma));

  async listRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]> {
    const query = notificationRecentQuerySchema.parse(input);

    const rows = await this.prisma.notification.findMany({
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

    const row = await this.prisma.notification.create({
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
