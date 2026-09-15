import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";
import { PrismaNotificationRepository } from "../prisma.notification.repository.ts";

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
  const create = vi.fn<() => Promise<(typeof rows)[number]>>().mockResolvedValue(rows[0]!);
  const prisma = { notification: { findMany, create } } as unknown as PrismaClient;

  return { prisma, findMany, create };
}

describe("PrismaNotificationRepository", () => {
  describe("when an organization's recent records are read", () => {
    /** @scenario "Find recent organization notifications" */
    it("reads an organization's records since a timestamp, newest first", async () => {
      const since = new Date("2026-08-24T00:00:00.000Z");
      const { prisma, findMany } = makeDatabase();
      const repository = PrismaNotificationRepository.create({ prisma });

      await expect(
        repository.listRecentByOrganization({ organizationId: "organization-1", since }),
      ).resolves.toEqual(rows);

      expect(findMany).toHaveBeenCalledWith({
        where: { organizationId: "organization-1", sentAt: { gte: since } },
        orderBy: { sentAt: "desc" },
      });
    });
  });

  describe("when a record is written", () => {
    /** @scenario "Create a notification record" */
    it("writes the organization, the project and the moment it was sent", async () => {
      const sentAt = new Date("2026-08-25T00:00:00.000Z");
      const { prisma, create } = makeDatabase();
      const repository = PrismaNotificationRepository.create({ prisma });

      await repository.create({
        organizationId: "organization-1",
        metadata: { kind: "usage-limit" },
        sentAt,
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          organizationId: "organization-1",
          projectId: undefined,
          metadata: { kind: "usage-limit" },
          sentAt,
        },
      });
    });
  });
});
