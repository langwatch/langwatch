import { describe, expect, it, vi } from "vitest";

import { SubscriptionNotLinkedError } from "@langwatch/enterprise-billing-contract";
import { SeatSyncService } from "../index";
import { PrismaOrganizationPricingRepository } from "../repositories/prisma/prisma.organization-pricing.repository";

const createMockDb = ({ pricingModel }: { pricingModel: string | null }) => ({
  organization: {
    findUnique: vi.fn().mockResolvedValue(pricingModel === null ? null : { pricingModel }),
  },
});

describe("seatSyncService", () => {
  describe("syncSeatsToStripe()", () => {
    describe("when the organization is not on seat-event pricing", () => {
      it("returns false without touching the subscription", async () => {
        const seatEventFns = { updateSeatEventItems: vi.fn() };
        const service = SeatSyncService.create({
          seatEvents: seatEventFns as any,
          organizations: PrismaOrganizationPricingRepository.create(
            createMockDb({ pricingModel: "TIERED" }) as any,
          ),
        });

        await expect(
          service.syncSeatsToStripe({
            organizationId: "org_1",
            newTotalSeats: 4,
          }),
        ).resolves.toBe(false);
        expect(seatEventFns.updateSeatEventItems).not.toHaveBeenCalled();
      });
    });

    describe("when the seat update succeeds", () => {
      it("returns true", async () => {
        const seatEventFns = {
          updateSeatEventItems: vi.fn().mockResolvedValue({ success: true }),
        };
        const service = SeatSyncService.create({
          seatEvents: seatEventFns as any,
          organizations: PrismaOrganizationPricingRepository.create(
            createMockDb({ pricingModel: "SEAT_EVENT" }) as any,
          ),
        });

        await expect(
          service.syncSeatsToStripe({
            organizationId: "org_1",
            newTotalSeats: 4,
          }),
        ).resolves.toBe(true);
      });
    });

    describe("when the seat update fails with a handled error", () => {
      it("keeps its boolean contract and resolves false", async () => {
        const seatEventFns = {
          updateSeatEventItems: vi.fn().mockRejectedValue(new SubscriptionNotLinkedError()),
        };
        const service = SeatSyncService.create({
          seatEvents: seatEventFns as any,
          organizations: PrismaOrganizationPricingRepository.create(
            createMockDb({ pricingModel: "SEAT_EVENT" }) as any,
          ),
        });

        await expect(
          service.syncSeatsToStripe({
            organizationId: "org_1",
            newTotalSeats: 4,
          }),
        ).resolves.toBe(false);
      });
    });

    describe("when the seat update fails for a reason we cannot name", () => {
      it("lets the plain error through untouched", async () => {
        const failure = new Error("socket hang up");
        const seatEventFns = {
          updateSeatEventItems: vi.fn().mockRejectedValue(failure),
        };
        const service = SeatSyncService.create({
          seatEvents: seatEventFns as any,
          organizations: PrismaOrganizationPricingRepository.create(
            createMockDb({ pricingModel: "SEAT_EVENT" }) as any,
          ),
        });

        await expect(
          service.syncSeatsToStripe({
            organizationId: "org_1",
            newTotalSeats: 4,
          }),
        ).rejects.toBe(failure);
      });
    });
  });
});
