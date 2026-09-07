import {
  createNotificationCommandSchema,
  notificationRecentQuerySchema,
  type CreateNotificationCommand,
  type Notification,
  type NotificationRecentQuery,
} from "@langwatch/notification-contract";
import { NotificationRepository } from "../repositories/notification.repository.ts";

/** Canonical Notification service; delivery policy remains outside this class. */
export class DefaultNotificationService {
  private constructor(private readonly repository: NotificationRepository) {}

  static create(options: { repository: NotificationRepository }): DefaultNotificationService {
    return new DefaultNotificationService(options.repository);
  }

  listRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]> {
    return this.repository.listRecentByOrganization(notificationRecentQuerySchema.parse(input));
  }

  create(input: CreateNotificationCommand): Promise<Notification> {
    return this.repository.create(createNotificationCommandSchema.parse(input));
  }
}
