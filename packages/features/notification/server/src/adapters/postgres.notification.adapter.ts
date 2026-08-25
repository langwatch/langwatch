import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { NotificationService as NotificationServiceContract } from "@langwatch/notification-contract";
import { PrismaNotificationRepository } from "../repositories/prisma/prisma.notification.repository";
import { NotificationService } from "../services/notification.service";

/** Process composition for the PostgreSQL-backed Notification capability. */
export class PostgresNotificationAdapter {
  private constructor(private readonly database: PrismaClient) {}

  static create(options: { database: PrismaClient }): PostgresNotificationAdapter {
    return new PostgresNotificationAdapter(options.database);
  }

  build(): NotificationServiceContract {
    return NotificationService.create({
      repository: PrismaNotificationRepository.create(this.database),
    });
  }
}
