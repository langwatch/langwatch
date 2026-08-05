import { describe, expect, it, vi } from "vitest";
import { PrismaWebhookDeliveryRepository } from "../webhook-delivery.prisma.repository";

describe("PrismaWebhookDeliveryRepository", () => {
  describe("deleteOlderThan", () => {
    it("prunes each project with an explicit tenancy predicate", async () => {
      const deleteMany = vi
        .fn()
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce({ count: 3 });
      const prisma = {
        project: {
          findMany: vi.fn().mockResolvedValue([{ id: "p1" }, { id: "p2" }]),
        },
        webhookDelivery: { deleteMany },
      };
      const before = new Date("2026-06-18T00:00:00.000Z");

      const deleted = await new PrismaWebhookDeliveryRepository(
        prisma as never,
      ).deleteOlderThan({ before });

      expect(deleted).toBe(5);
      expect(deleteMany).toHaveBeenNthCalledWith(1, {
        where: { projectId: "p1", firedAt: { lt: before } },
      });
      expect(deleteMany).toHaveBeenNthCalledWith(2, {
        where: { projectId: "p2", firedAt: { lt: before } },
      });
    });
  });
});
