import {
  NotificationService as NotificationServiceContract,
  createNotificationCommandSchema,
  notificationRecentQuerySchema,
  type CreateNotificationCommand,
  type Notification,
  type NotificationRecentQuery,
} from "@langwatch/notification-contract";
import { NotificationRepository } from "../repositories/notification.repository";

/** Canonical Notification service; delivery policy remains outside this class. */
export class NotificationService extends NotificationServiceContract {
  private constructor(private readonly repository: NotificationRepository) {
    super();
  }

  static create(options: { repository: NotificationRepository }): NotificationService {
    return new NotificationService(options.repository);
  }

  listRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]> {
    return this.repository.listRecentByOrganization(notificationRecentQuerySchema.parse(input));
  }

  create(input: CreateNotificationCommand): Promise<Notification> {
    return this.repository.create(createNotificationCommandSchema.parse(input));
  }
}
