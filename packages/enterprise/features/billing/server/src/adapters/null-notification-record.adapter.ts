/**
 * A notification record store that keeps nothing.
 *
 * `UsageLimitService.createNull()` uses it so a caller can exercise the
 * decision — should this alert be sent, to whom — without a database. It
 * answers "no notifications yet" to every read, so the 30-day window never
 * suppresses anything, and returns a plausible record from `create` rather
 * than nothing, because callers read the id off it.
 */

import {
  NotificationService as NotificationRecordService,
  type CreateNotificationCommand,
  type Notification,
  type NotificationRecentQuery,
} from "@langwatch/notification-contract";

export class NullNotificationRecordAdapter extends NotificationRecordService {
  listRecentByOrganization(_input: NotificationRecentQuery): Promise<Notification[]> {
    return Promise.resolve([]);
  }

  create(input: CreateNotificationCommand): Promise<Notification> {
    return Promise.resolve({
      id: "notification_null",
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      metadata: input.metadata,
      sentAt: input.sentAt,
      createdAt: input.sentAt,
      updatedAt: input.sentAt,
    });
  }
}
