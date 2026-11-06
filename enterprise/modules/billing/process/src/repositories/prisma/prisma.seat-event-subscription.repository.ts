import {
  GROWTH_SEAT_PLAN_TYPES,
  type GrowthSeatPlanType,
} from "@langwatch/enterprise-billing-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, nowInstant, toDate } from "@langwatch/time";

import type { KeptSeats } from "../../rules/seat-kept.rules.ts";
import {
  SeatEventSubscriptionRepository,
  type SeatSubscriptionRow,
} from "../seat-event-subscription.repository.ts";

/** Only what this repository touches. */
type SeatEventSubscriptionDatabase = Pick<PrismaClient, "subscription">;

export class PrismaSeatEventSubscriptionRepository extends SeatEventSubscriptionRepository {
  private constructor(private readonly prisma: SeatEventSubscriptionDatabase) {
    super();
  }

  static create(prisma: SeatEventSubscriptionDatabase): PrismaSeatEventSubscriptionRepository {
    return new PrismaSeatEventSubscriptionRepository(prisma);
  }

  async findSeatCandidates({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SeatSubscriptionRow[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { organizationId, status: { in: ["ACTIVE", "CANCELLED"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        stripeSubscriptionId: true,
        maxMembers: true,
        seatsKept: true,
        seatsKeptUntil: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      seatsKeptUntil: row.seatsKeptUntil ? fromDate(row.seatsKeptUntil) : null,
    }));
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

  async reactivateWithSeats({
    id,
    maxMembers,
    kept,
  }: {
    id: string;
    maxMembers: number;
    kept: KeptSeats | null;
  }): Promise<void> {
    await this.prisma.subscription.update({
      where: { id },
      data: {
        status: "ACTIVE",
        maxMembers,
        endDate: null,
        seatsKept: kept?.seats ?? null,
        seatsKeptUntil: kept ? toDate(kept.until) : null,
      },
    });
  }
}
