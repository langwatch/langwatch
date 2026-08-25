import type {
  CreateNotificationCommand,
  Notification,
  NotificationRecentQuery,
} from "./notification";

/**
 * Canonical notification record capability.
 *
 * Delivery providers and notification policy are injected by the owning
 * application or feature. This service owns durable notification records;
 * it does not know about mail, Slack, HubSpot, queues, or HTTP transports.
 */
export abstract class NotificationService {
  abstract listRecentByOrganization(
    input: NotificationRecentQuery,
  ): Promise<Notification[]>;

  abstract create(input: CreateNotificationCommand): Promise<Notification>;
}
