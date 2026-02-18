import type { PrismaClient } from "@prisma/client";
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

    if (org?.pricingModel !== "SEAT_EVENT") {
      return false;
    }

    const result = await seatEventFns.updateSeatEventItems({
      organizationId,
      totalMembers: newTotalSeats,
    });

    return result.success;
  },
});
