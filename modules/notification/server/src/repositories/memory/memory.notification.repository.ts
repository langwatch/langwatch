import {
  createNotificationCommandSchema,
  notificationRecentQuerySchema,
  notificationSchema,
  type CreateNotificationCommand,
  type Notification,
  type NotificationRecentQuery,
} from "@langwatch/notification-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant, toDate } from "@langwatch/time";
import type { NotificationRepository } from "../notification.repository.ts";

export class MemoryNotificationRepository implements NotificationRepository {
  #records: Notification[] = [];

  private constructor() {}

  static create(): MemoryNotificationRepository {
    return new MemoryNotificationRepository();
  }

  async listRecentByOrganization(input: NotificationRecentQuery): Promise<Notification[]> {
    const query = notificationRecentQuerySchema.parse(input);

    return this.#records
      .filter(
        (record) => record.organizationId === query.organizationId && record.sentAt >= query.since,
      )
      .sort((left, right) => right.sentAt.getTime() - left.sentAt.getTime())
      .map((record) => structuredClone(record));
  }

  async create(input: CreateNotificationCommand): Promise<Notification> {
    const command = createNotificationCommandSchema.parse(input);
    const written = toDate(nowInstant());

    const notification = notificationSchema.parse({
      id: generate("notification").toString(),
      organizationId: command.organizationId,
      projectId: command.projectId ?? null,
      metadata: command.metadata,
      createdAt: written,
      updatedAt: written,
      sentAt: command.sentAt,
    });

    this.#records.push(notification);

    return structuredClone(notification);
  }
}
