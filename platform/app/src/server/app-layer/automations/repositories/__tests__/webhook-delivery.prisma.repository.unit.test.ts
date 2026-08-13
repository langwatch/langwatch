import { describe, expect, it, vi } from "vitest";
import { PrismaWebhookDeliveryRepository } from "../webhook-delivery.prisma.repository";

describe("PrismaWebhookDeliveryRepository", () => {
  describe("create", () => {
    it("writes into the shared log tagged as an automations row", async () => {
      const create = vi.fn().mockResolvedValue(undefined);
      const prisma = { webhookEndpointDelivery: { create } };

      await new PrismaWebhookDeliveryRepository(prisma as never).create({
        projectId: "p1",
        triggerId: "t1",
        dispatchId: "evt_1",
        responseStatus: 200,
        latencyMs: 42,
        outcome: "success",
      });

      const data = create.mock.calls[0]![0].data as Record<string, unknown>;
      expect(data.channel).toBe("automations");
      expect(data.projectId).toBe("p1");
      expect(data.triggerId).toBe("t1");
      // The platform's tenancy columns stay untouched on an automations row.
      expect(data.organizationId).toBeUndefined();
      expect(data.endpointId).toBeUndefined();
    });
  });

  describe("findAllRecentByTriggerId", () => {
    it("reads only this channel's rows out of the shared log", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = { webhookEndpointDelivery: { findMany } };

      await new PrismaWebhookDeliveryRepository(
        prisma as never,
      ).findAllRecentByTriggerId({
        projectId: "p1",
        triggerId: "t1",
        limit: 25,
      });

      expect(findMany).toHaveBeenCalledWith({
        where: { channel: "automations", projectId: "p1", triggerId: "t1" },
        orderBy: { firedAt: "desc" },
        take: 25,
      });
    });
  });

  describe("pruneExpired", () => {
    it("runs one global sweep instead of a delete per project", async () => {
      const executeRaw = vi.fn().mockResolvedValue(5);
      const findMany = vi.fn();
      const prisma = {
        $executeRaw: executeRaw,
        project: { findMany },
      };

      const deleted = await new PrismaWebhookDeliveryRepository(
        prisma as never,
      ).pruneExpired(new Date("2026-08-04T00:00:00.000Z"));

      expect(deleted).toBe(5);
      expect(executeRaw).toHaveBeenCalledTimes(1);
      // The old implementation enumerated every Project to satisfy the tenancy
      // guard, costing one statement per tenant. Retention is system-owned.
      expect(findMany).not.toHaveBeenCalled();
      const before = executeRaw.mock.calls[0]![1] as Date;
      const daysAgo =
        (new Date("2026-08-04T00:00:00.000Z").getTime() - before.getTime()) /
        (24 * 60 * 60 * 1000);
      expect(daysAgo).toBe(30);
    });
  });
});
