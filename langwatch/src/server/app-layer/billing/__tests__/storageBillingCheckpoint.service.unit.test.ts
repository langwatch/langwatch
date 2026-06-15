import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaStorageBillingCheckpointService } from "../storageBillingCheckpoint.service";

/**
 * The storage checkpoint lives in its own table (StorageBillingCheckpoint),
 * keyed by (organizationId, billingMonth). These tests pin that the service
 * reads/writes ONLY that table — never BillingMeterCheckpoint — so storage
 * billing stays fully decoupled from the billable-events checkpoint.
 */
const makePrisma = () => {
  const storageBillingCheckpoint = {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const billingMeterCheckpoint = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  };
  return {
    prisma: {
      storageBillingCheckpoint,
      billingMeterCheckpoint,
    } as unknown as PrismaClient,
    storageBillingCheckpoint,
    billingMeterCheckpoint,
  };
};

describe("PrismaStorageBillingCheckpointService", () => {
  describe("given a checkpoint lookup", () => {
    it("reads the dedicated storage table scoped by organizationId and billingMonth", async () => {
      const { prisma, storageBillingCheckpoint, billingMeterCheckpoint } =
        makePrisma();
      const service = new PrismaStorageBillingCheckpointService(prisma);

      await service.getCheckpoint({
        organizationId: "org-1",
        billingMonth: "2026-02",
      });

      expect(storageBillingCheckpoint.findUnique).toHaveBeenCalledWith({
        where: {
          organizationId_billingMonth: {
            organizationId: "org-1",
            billingMonth: "2026-02",
          },
        },
      });
      // Never touches the billable-events checkpoint.
      expect(billingMeterCheckpoint.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("when writing intent then confirming", () => {
    it("upserts the storage table only, clearing pending and resetting failures on confirm", async () => {
      const { prisma, storageBillingCheckpoint, billingMeterCheckpoint } =
        makePrisma();
      const service = new PrismaStorageBillingCheckpointService(prisma);

      await service.writeIntent({
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 0,
        pendingReportedTotal: 5,
      });
      await service.confirm({
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 5,
      });

      expect(storageBillingCheckpoint.upsert).toHaveBeenCalledTimes(2);
      expect(storageBillingCheckpoint.upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: {
            organizationId_billingMonth: {
              organizationId: "org-1",
              billingMonth: "2026-02",
            },
          },
          update: {
            lastReportedTotal: 5,
            pendingReportedTotal: null,
            consecutiveFailures: 0,
          },
        }),
      );
      expect(billingMeterCheckpoint.upsert).not.toHaveBeenCalled();
    });
  });

  describe("when a transient failure occurs", () => {
    it("increments failures on the storage table without clearing pending", async () => {
      const { prisma, storageBillingCheckpoint } = makePrisma();
      const service = new PrismaStorageBillingCheckpointService(prisma);

      await service.incrementFailures({
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 0,
        pendingReportedTotal: 5,
        consecutiveFailures: 3,
      });

      expect(storageBillingCheckpoint.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { consecutiveFailures: 3 },
        }),
      );
    });
  });
});
