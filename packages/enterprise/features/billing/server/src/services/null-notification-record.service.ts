/**
 * A notification record store that keeps nothing.
 */

import {
  NotificationService as NotificationRecordService,
  type CreateNotificationCommand,
  type Notification,
  type NotificationRecentQuery,
} from "@langwatch/notification-contract";

export class NullNotificationRecordService extends NotificationRecordService {
  static create(): NullNotificationRecordService {
    return new NullNotificationRecordService();
  }

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
