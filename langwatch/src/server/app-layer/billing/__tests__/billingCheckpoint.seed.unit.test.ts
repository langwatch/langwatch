import { describe, expect, it, vi } from "vitest";
import { PrismaBillingCheckpointService } from "../billingCheckpoint.service";

function makePrisma({ existing }: { existing: boolean }) {
  return {
    billingMeterCheckpoint: {
      findUnique: vi
        .fn()
        .mockResolvedValue(existing ? { organizationId: "org-1" } : null),
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("PrismaBillingCheckpointService.seedIfAbsent()", () => {
  describe("when no checkpoint exists for the billing month", () => {
    it("creates the checkpoint at the month-to-date total", async () => {
      const prisma = makePrisma({ existing: false });
      const service = new PrismaBillingCheckpointService(prisma as never);

      const result = await service.seedIfAbsent({
        organizationId: "org-1",
        billingMonth: "2026-07",
        monthToDateTotal: 10_000,
      });

      expect(result.seeded).toBe(true);
      expect(prisma.billingMeterCheckpoint.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: "org-1",
          billingMonth: "2026-07",
          lastReportedTotal: 10_000,
        }),
      });
    });
  });

  describe("when a checkpoint already exists", () => {
    /** @scenario Seeding never lowers an existing checkpoint */
    it("does not modify the existing checkpoint", async () => {
      const prisma = makePrisma({ existing: true });
      const service = new PrismaBillingCheckpointService(prisma as never);

      const result = await service.seedIfAbsent({
        organizationId: "org-1",
        billingMonth: "2026-07",
        monthToDateTotal: 10_000,
      });

      expect(result.seeded).toBe(false);
      expect(prisma.billingMeterCheckpoint.create).not.toHaveBeenCalled();
    });

    /** @scenario Seeding is idempotent */
    it("leaves the checkpoint unchanged on a repeat run", async () => {
      const prisma = makePrisma({ existing: true });
      const service = new PrismaBillingCheckpointService(prisma as never);

      await service.seedIfAbsent({
        organizationId: "org-1",
        billingMonth: "2026-07",
        monthToDateTotal: 10_000,
      });
      await service.seedIfAbsent({
        organizationId: "org-1",
        billingMonth: "2026-07",
        monthToDateTotal: 10_000,
      });

      expect(prisma.billingMeterCheckpoint.create).not.toHaveBeenCalled();
    });
  });
});
