import {
  GROWTH_SEAT_PLAN_TYPES,
  type GrowthSeatPlanType,
} from "@langwatch/enterprise-billing-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, type Instant, nowInstant, toDate } from "@langwatch/time";

import type { KeptSeats } from "../../rules/seat-kept.rules.ts";
import {
  SeatEventSubscriptionRepository,
  type SeatRepairRow,
  type SeatSubscriptionRow,
} from "../seat-event-subscription.repository.ts";

/** The repair columns of a subscription with no seat line repair pending. */
const NO_SEAT_REPAIR = {
  seatRepairQuantity: null,
  seatRepairSince: null,
  seatRepairAttempts: null,
  seatRepairFlaggedAt: null,
};

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

  async keepSeats({ id, kept }: { id: string; kept: KeptSeats }): Promise<void> {
    await this.prisma.subscription.update({
      where: { id },
      data: { seatsKept: kept.seats, seatsKeptUntil: toDate(kept.until) },
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
        ...NO_SEAT_REPAIR,
      },
    });
  }

  async recordSeatRepair({ id, quantity }: { id: string; quantity: number }): Promise<void> {
    await this.prisma.subscription.update({
      where: { id },
      data: {
        seatRepairQuantity: quantity,
        seatRepairSince: toDate(nowInstant()),
        seatRepairAttempts: 0,
        seatRepairFlaggedAt: null,
      },
    });
  }

  async findSeatRepairs(): Promise<SeatRepairRow[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { seatRepairQuantity: { not: null }, stripeSubscriptionId: { not: null } },
      orderBy: { seatRepairSince: "asc" },
      select: {
        id: true,
        organizationId: true,
        stripeSubscriptionId: true,
        seatRepairQuantity: true,
        seatRepairAttempts: true,
        seatRepairFlaggedAt: true,
      },
    });
    return rows.flatMap((row) =>
      row.seatRepairQuantity !== null && row.stripeSubscriptionId !== null
        ? [
            {
              id: row.id,
              organizationId: row.organizationId,
              stripeSubscriptionId: row.stripeSubscriptionId,
              quantity: row.seatRepairQuantity,
              attempts: row.seatRepairAttempts ?? 0,
              flaggedAt: row.seatRepairFlaggedAt ? fromDate(row.seatRepairFlaggedAt) : null,
            },
          ]
        : [],
    );
  }

  async clearSeatRepair({ id, quantity }: { id: string; quantity: number }): Promise<void> {
    await this.prisma.subscription.updateMany({
      where: { id, seatRepairQuantity: quantity },
      data: NO_SEAT_REPAIR,
    });
  }

  async recordSeatRepairFailure({
    id,
    quantity,
    attempts,
    flaggedAt,
  }: {
    id: string;
    quantity: number;
    attempts: number;
    flaggedAt: Instant | null;
  }): Promise<void> {
    await this.prisma.subscription.updateMany({
      where: { id, seatRepairQuantity: quantity },
      data: {
        seatRepairAttempts: attempts,
        seatRepairFlaggedAt: flaggedAt ? toDate(flaggedAt) : null,
      },
    });
  }
}
