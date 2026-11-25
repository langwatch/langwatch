import type {
  CreateNotificationCommand,
  Notification,
  NotificationRecentQuery,
} from "@langwatch/notification-contract";

/** Private persistence capability for the Notification service. */
export interface NotificationRepository {
  findRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]>;
  create(input: CreateNotificationCommand): Promise<Notification>;
}
