import { describe, expect, it, vi } from "vitest";
import type {
  CreateNotificationCommand,
  Notification,
} from "@langwatch/notification-contract";
import { NotificationRepository } from "../src/repositories/notification.repository";
import { NotificationService } from "../src/services/notification.service";

class InMemoryNotificationRepository extends NotificationRepository {
  private readonly records: Notification[] = [];

  listRecentByOrganization = vi.fn(
    async (input: { organizationId: string; since: Date }) =>
      this.records
        .filter(
          (record) =>
            record.organizationId === input.organizationId &&
            record.sentAt >= input.since,
        )
        .sort((left, right) => right.sentAt.getTime() - left.sentAt.getTime()),
  );

  create = vi.fn(async (input: CreateNotificationCommand) => {
    const timestamp = new Date();
    const notification: Notification = {
      id: `notification-${this.records.length + 1}`,
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      metadata: input.metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      sentAt: input.sentAt,
    };
    this.records.push(notification);
    return notification;
  });
}

describe("NotificationService", () => {
  it("creates and queries durable records through one repository", async () => {
    const repository = new InMemoryNotificationRepository();
    const service = NotificationService.create({ repository });
    const sentAt = new Date("2026-08-25T00:00:00.000Z");

    const notification = await service.create({
      organizationId: "organization-1",
      metadata: { kind: "usage-limit" },
      sentAt,
    });

    await expect(
      service.listRecentByOrganization({
        organizationId: "organization-1",
        since: new Date("2026-08-24T00:00:00.000Z"),
      }),
    ).resolves.toEqual([notification]);
  });
});
