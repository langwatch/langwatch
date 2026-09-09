import {
  createNotificationCommandSchema,
  notificationRecentQuerySchema,
  type CreateNotificationCommand,
  type Notification,
  type NotificationRecentQuery,
} from "@langwatch/notification-contract";
import type { NotificationRepository } from "../repositories/notification.repository.ts";

/** Canonical Notification service; delivery policy remains outside this class. */
export class NotificationService {
  #repository: NotificationRepository;

  private constructor(repository: NotificationRepository) {
    this.#repository = repository;
  }

  static create(options: { repository: NotificationRepository }): NotificationService {
    return new NotificationService(options.repository);
  }

  listRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]> {
    return this.#repository.listRecentByOrganization(notificationRecentQuerySchema.parse(input));
  }

  create(input: CreateNotificationCommand): Promise<Notification> {
    return this.#repository.create(createNotificationCommandSchema.parse(input));
  }
}
