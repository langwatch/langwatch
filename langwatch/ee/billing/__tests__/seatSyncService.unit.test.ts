import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeatSyncService } from "../services/seatSyncService";

const createMockSeatEventFns = () => ({
  createSeatEventCheckout: vi.fn(),
  updateSeatEventItems: vi.fn(),
  seatEventBillingPortalUrl: vi.fn(),
});

const createMockDb = () => ({
  organization: {
    findUnique: vi.fn(),
  },
});

describe("seatSyncService", () => {
  let seatEventFns: ReturnType<typeof createMockSeatEventFns>;
  let db: ReturnType<typeof createMockDb>;
  let service: ReturnType<typeof createSeatSyncService>;

  beforeEach(() => {
    vi.clearAllMocks();
    seatEventFns = createMockSeatEventFns();
    db = createMockDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = createSeatSyncService({ seatEventFns: seatEventFns as any, db: db as any });
  });

  describe("syncSeatsToStripe", () => {
    describe("when organization uses SEAT_EVENT pricing model", () => {
      it("delegates to seatEventFns.updateSeatEventItems", async () => {
        db.organization.findUnique.mockResolvedValue({
          pricingModel: "SEAT_EVENT",
        });
        seatEventFns.updateSeatEventItems.mockResolvedValue({ success: true });

        const result = await service.syncSeatsToStripe({
          organizationId: "org_1",
          newTotalSeats: 7,
        });

        expect(seatEventFns.updateSeatEventItems).toHaveBeenCalledWith({
          organizationId: "org_1",
          totalMembers: 7,
        });
        expect(result).toBe(true);
      });
    });

    describe("when organization uses TIERED pricing model", () => {
      it("returns false without calling seatEventFns", async () => {
        db.organization.findUnique.mockResolvedValue({
          pricingModel: "TIERED",
        });

        const result = await service.syncSeatsToStripe({
          organizationId: "org_1",
          newTotalSeats: 5,
        });

        expect(seatEventFns.updateSeatEventItems).not.toHaveBeenCalled();
        expect(result).toBe(false);
      });
    });

    describe("when organization does not exist", () => {
      it("returns false", async () => {
        db.organization.findUnique.mockResolvedValue(null);

        const result = await service.syncSeatsToStripe({
          organizationId: "org_nonexistent",
          newTotalSeats: 3,
        });

        expect(result).toBe(false);
      });
    });
  });
});
