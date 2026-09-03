import { describe, expect, it, vi } from "vitest";
import {
  PrismaNotificationRepository,
  type NotificationDatabase,
} from "../prisma.notification.repository";

const rows = [
  {
    id: "notification-2",
    organizationId: "organization-1",
    projectId: null,
    metadata: { kind: "usage-limit" },
    createdAt: new Date("2026-08-25T00:00:00.000Z"),
    updatedAt: new Date("2026-08-25T00:00:00.000Z"),
    sentAt: new Date("2026-08-25T00:00:00.000Z"),
  },
  {
    id: "notification-1",
    organizationId: "organization-1",
    projectId: null,
    metadata: { kind: "usage-limit" },
    createdAt: new Date("2026-08-24T00:00:00.000Z"),
    updatedAt: new Date("2026-08-24T00:00:00.000Z"),
    sentAt: new Date("2026-08-24T12:00:00.000Z"),
  },
];

function makeDatabase() {
  const findMany = vi.fn<() => Promise<typeof rows>>().mockResolvedValue(rows);
  const database = {
    notification: { findMany },
  } as unknown as NotificationDatabase;
  return { database, findMany };
}

describe("PrismaNotificationRepository", () => {
  /** @scenario "Find recent organization notifications" */
  it("reads an organization's records since a timestamp, newest first", async () => {
    const since = new Date("2026-08-24T00:00:00.000Z");
    const { database, findMany } = makeDatabase();
    const repository = PrismaNotificationRepository.create(database);

    await expect(
      repository.listRecentByOrganization({ organizationId: "organization-1", since }),
    ).resolves.toEqual(rows);
    expect(findMany).toHaveBeenCalledWith({
      where: { organizationId: "organization-1", sentAt: { gte: since } },
      orderBy: { sentAt: "desc" },
    });
  });
});
