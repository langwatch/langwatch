import { HandledError } from "@langwatch/handled-error";
import { PricingModel, type PrismaClient } from "@prisma/client";
import type { SeatEventSubscriptionFns } from "./seatEventSubscription";

export const createSeatSyncService = ({
  seatEventFns,
  db,
}: {
  seatEventFns: SeatEventSubscriptionFns;
  db: PrismaClient;
}) => ({
  async syncSeatsToStripe({
    organizationId,
    newTotalSeats,
  }: {
    organizationId: string;
    newTotalSeats: number;
  }): Promise<boolean> {
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true },
    });

    if (org?.pricingModel !== PricingModel.SEAT_EVENT) {
      return false;
    }

    try {
      const result = await seatEventFns.updateSeatEventItems({
        organizationId,
        totalMembers: newTotalSeats,
      });
      return result.success;
    } catch (error) {
      // The seat updater throws handled errors for the states it can name
      // (no subscription, unlinked, missing item). This wrapper's contract is
      // a boolean, so those fold back to "did not sync"; anything unnamed
      // stays a plain error and keeps propagating.
      if (HandledError.isHandled(error)) {
        return false;
      }
      throw error;
    }
  },
});
