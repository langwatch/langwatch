import type {
  CreateNotificationCommand,
  Notification,
  NotificationRecentQuery,
} from "@langwatch/notification-contract";

/** Private persistence port for durable Notification records. */
export abstract class NotificationRepository {
  abstract listRecentByOrganization(
    input: NotificationRecentQuery,
  ): Promise<Notification[]>;

  abstract create(input: CreateNotificationCommand): Promise<Notification>;
}
