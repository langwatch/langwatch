import { describe, expect, it } from "vitest";
import { MemoryNotificationRepository } from "../../repositories/memory/memory.notification.repository.ts";
import { NotificationService } from "../notification.service.ts";

describe("NotificationService", () => {
  describe("given a record written for an organization", () => {
    /** @scenario "Create a notification record" */
    it("creates and queries durable records through one repository", async () => {
      const service = NotificationService.create({
        repository: MemoryNotificationRepository.create(),
      });
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
});
