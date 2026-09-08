import { describe, expect, it } from "vitest";
import { MemoryNotificationRepository } from "../memory.notification.repository.ts";

const metadata = { kind: "usage-limit" };

describe("MemoryNotificationRepository", () => {
  describe("when records are read back for one organization", () => {
    /** @scenario "Find recent organization notifications" */
    it("answers only that organization's records since a timestamp, newest first", async () => {
      const repository = MemoryNotificationRepository.create();

      const older = await repository.create({
        organizationId: "organization-1",
        metadata,
        sentAt: new Date("2026-08-24T12:00:00.000Z"),
      });
      const newer = await repository.create({
        organizationId: "organization-1",
        metadata,
        sentAt: new Date("2026-08-25T00:00:00.000Z"),
      });
      await repository.create({
        organizationId: "organization-2",
        metadata,
        sentAt: new Date("2026-08-25T00:00:00.000Z"),
      });

      await expect(
        repository.listRecentByOrganization({
          organizationId: "organization-1",
          since: new Date("2026-08-24T00:00:00.000Z"),
        }),
      ).resolves.toEqual([newer, older]);
    });

    it("leaves out records sent before the requested moment", async () => {
      const repository = MemoryNotificationRepository.create();

      await repository.create({
        organizationId: "organization-1",
        metadata,
        sentAt: new Date("2026-08-20T00:00:00.000Z"),
      });

      await expect(
        repository.listRecentByOrganization({
          organizationId: "organization-1",
          since: new Date("2026-08-24T00:00:00.000Z"),
        }),
      ).resolves.toEqual([]);
    });
  });

  describe("when a record is written without a project", () => {
    it("stores an absent project as no project at all", async () => {
      const repository = MemoryNotificationRepository.create();

      await expect(
        repository.create({
          organizationId: "organization-1",
          metadata,
          sentAt: new Date("2026-08-25T00:00:00.000Z"),
        }),
      ).resolves.toMatchObject({ projectId: null, organizationId: "organization-1" });
    });
  });
});
