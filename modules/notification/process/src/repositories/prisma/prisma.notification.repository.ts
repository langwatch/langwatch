import {
  notificationSchema,
  type CreateNotificationCommand,
  type Notification,
  type NotificationRecentQuery,
} from "@langwatch/notification-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { Prisma } from "@langwatch/prisma-client/generated";

import type { NotificationRepository } from "../notification.repository.ts";

export class PrismaNotificationRepository
  extends PrismaRepository.for("Notification")
  implements NotificationRepository
{
  static readonly create = this.factory((prisma) => new PrismaNotificationRepository(prisma));

  async findRecentByOrganization(query: NotificationRecentQuery): Promise<Notification[]> {
    const rows = await this.prisma.notification.findMany({
      where: {
        organizationId: query.organizationId,
        sentAt: { gte: query.since },
      },
      orderBy: { sentAt: "desc" },
    });

    return rows.map((row) => notificationSchema.parse(row));
  }

  async create(command: CreateNotificationCommand): Promise<Notification> {
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
