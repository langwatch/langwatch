import {
  PrismaNotificationRepository,
  type NotificationDatabase,
} from "../repositories/prisma/prisma.notification.repository.ts";
import { DefaultNotificationService } from "../services/notification.service.ts";

/** Process composition for the PostgreSQL-backed Notification capability. */
export class PostgresNotificationAdapter {
  private constructor(private readonly database: NotificationDatabase) {}

  static create(options: { database: NotificationDatabase }): PostgresNotificationAdapter {
    return new PostgresNotificationAdapter(options.database);
  }

  build(): DefaultNotificationService {
    return DefaultNotificationService.create({
      repository: PrismaNotificationRepository.create(this.database),
    });
  }
}
