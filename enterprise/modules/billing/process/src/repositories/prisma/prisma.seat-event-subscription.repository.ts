import {
  GROWTH_SEAT_PLAN_TYPES,
  type GrowthSeatPlanType,
} from "@langwatch/enterprise-billing-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nowInstant, toDate } from "@langwatch/time";

import {
  SeatEventSubscriptionRepository,
  type SeatSubscriptionRow,
} from "../seat-event-subscription.repository.ts";

/** Only what this repository touches. */
export type SeatEventSubscriptionDatabase = Pick<PrismaClient, "subscription">;

export class PrismaSeatEventSubscriptionRepository extends SeatEventSubscriptionRepository {
  private constructor(private readonly prisma: SeatEventSubscriptionDatabase) {
    super();
  }

  static create(prisma: SeatEventSubscriptionDatabase): PrismaSeatEventSubscriptionRepository {
    return new PrismaSeatEventSubscriptionRepository(prisma);
  }

  findSeatCandidates({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SeatSubscriptionRow[]> {
    return this.prisma.subscription.findMany({
      where: { organizationId, status: { in: ["ACTIVE", "CANCELLED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, stripeSubscriptionId: true },
    });
  }

  async cancelPendingSeatCheckouts({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string[]> {
    const where = {
      organizationId,
      plan: { in: [...GROWTH_SEAT_PLAN_TYPES] },
      status: "PENDING" as const,
    };
    const stale = await this.prisma.subscription.findMany({ where, select: { id: true } });
    await this.prisma.subscription.updateMany({
      where,
      data: { status: "CANCELLED", endDate: toDate(nowInstant()) },
    });
    return stale.map((subscription) => subscription.id);
  }

  createPendingSeatCheckout(input: {
    organizationId: string;
    plan: GrowthSeatPlanType;
    maxMembers: number;
  }): Promise<{ id: string }> {
    return this.prisma.subscription.create({
      data: { ...input, status: "PENDING" },
      select: { id: true },
    });
  }

  async reactivateWithSeats({ id, maxMembers }: { id: string; maxMembers: number }): Promise<void> {
    await this.prisma.subscription.update({
      where: { id },
      data: { status: "ACTIVE", maxMembers, endDate: null },
    });
  }
}
