import type { NotificationService as NotificationServiceContract } from "@langwatch/notification-contract";
import {
  PrismaNotificationRepository,
  type NotificationDatabase,
} from "../repositories/prisma/prisma.notification.repository";
import { NotificationService } from "../services/notification.service";

/** Process composition for the PostgreSQL-backed Notification capability. */
export class PostgresNotificationAdapter {
  private constructor(private readonly database: NotificationDatabase) {}

  static create(options: { database: NotificationDatabase }): PostgresNotificationAdapter {
    return new PostgresNotificationAdapter(options.database);
  }

  build(): NotificationServiceContract {
    return NotificationService.create({
      repository: PrismaNotificationRepository.create(this.database),
    });
  }
}
