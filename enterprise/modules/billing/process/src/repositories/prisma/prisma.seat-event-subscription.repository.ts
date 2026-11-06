import {
  GROWTH_SEAT_PLAN_TYPES,
  type GrowthSeatPlanType,
} from "@langwatch/enterprise-billing-contract";
import { generate } from "@langwatch/ksuid";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, type Instant, nowInstant, toDate } from "@langwatch/time";

import type { KeptSeats } from "../../rules/seat-kept.rules.ts";
import {
  SeatEventSubscriptionRepository,
  type SeatLineClaim,
  type SeatLiftRecord,
  type SeatRepairRecord,
  type SeatRepairRow,
  type SeatSubscriptionRow,
} from "../seat-event-subscription.repository.ts";

/** The repair columns of a subscription with no seat line repair pending. */
const NO_SEAT_REPAIR = {
  seatRepairQuantity: null,
  seatRepairLiftedQuantity: null,
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
      data: { ...input, seatLineQuantity: input.maxMembers, status: "PENDING" },
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
    repairsUpTo,
  }: {
    id: string;
    maxMembers: number;
    kept: KeptSeats | null;
    repairsUpTo: Instant;
  }): Promise<void> {
    await this.prisma.subscription.update({
      where: { id },
      data: {
        status: "ACTIVE",
        maxMembers,
        seatLineQuantity: maxMembers,
        endDate: null,
        seatsKept: kept?.seats ?? null,
        seatsKeptUntil: kept ? toDate(kept.until) : null,
      },
    });
    await this.prisma.subscription.updateMany({
      where: { id, seatRepairSince: { lte: toDate(repairsUpTo) } },
      data: NO_SEAT_REPAIR,
    });
  }

  async recordSeatRepair({
    id,
    quantity,
    liftedQuantity,
  }: {
    id: string;
    quantity: number;
    liftedQuantity: number;
  }): Promise<SeatLiftRecord> {
    const since = await this.writeSeatRepair({ id, quantity, liftedQuantity });
    return { quantity, liftedQuantity, since };
  }

  async recordSeatLineReconcile({ id }: { id: string }): Promise<SeatRepairRecord> {
    const since = await this.writeSeatRepair({ id, quantity: null, liftedQuantity: null });
    return { quantity: null, liftedQuantity: null, since };
  }

  async findSeatLineTarget({ id }: { id: string }): Promise<number | null> {
    const row = await this.prisma.subscription.findUnique({
      where: { id },
      select: { seatLineQuantity: true, maxMembers: true },
    });
    return row?.seatLineQuantity ?? row?.maxMembers ?? null;
  }

  private async writeSeatRepair({
    id,
    quantity,
    liftedQuantity,
  }: {
    id: string;
    quantity: number | null;
    liftedQuantity: number | null;
  }): Promise<Instant> {
    // Whole milliseconds, as the column keeps them, so the record matches its row exactly.
    const since = fromDate(toDate(nowInstant()));
    await this.prisma.subscription.update({
      where: { id },
      data: {
        seatRepairQuantity: quantity,
        seatRepairLiftedQuantity: liftedQuantity,
        seatRepairSince: toDate(since),
        seatRepairAttempts: 0,
        seatRepairFlaggedAt: null,
      },
    });
    return since;
  }

  async findSeatRepairs({ recordedBefore }: { recordedBefore: Instant }): Promise<SeatRepairRow[]> {
    const rows = await this.prisma.subscription.findMany({
      where: {
        seatRepairSince: { lt: toDate(recordedBefore) },
        stripeSubscriptionId: { not: null },
      },
      orderBy: { seatRepairSince: "asc" },
      select: {
        id: true,
        organizationId: true,
        stripeSubscriptionId: true,
        seatRepairQuantity: true,
        seatRepairLiftedQuantity: true,
        seatRepairSince: true,
        seatRepairAttempts: true,
        seatRepairFlaggedAt: true,
      },
    });
    return rows.flatMap((row) =>
      row.seatRepairSince !== null && row.stripeSubscriptionId !== null
        ? [
            {
              id: row.id,
              organizationId: row.organizationId,
              stripeSubscriptionId: row.stripeSubscriptionId,
              quantity: row.seatRepairQuantity,
              liftedQuantity: row.seatRepairLiftedQuantity,
              since: fromDate(row.seatRepairSince),
              attempts: row.seatRepairAttempts ?? 0,
              flaggedAt: row.seatRepairFlaggedAt ? fromDate(row.seatRepairFlaggedAt) : null,
            },
          ]
        : [],
    );
  }

  async isSeatRepairPending({
    id,
    record,
  }: {
    id: string;
    record: SeatRepairRecord;
  }): Promise<boolean> {
    const count = await this.prisma.subscription.count({ where: sameRepair({ id, record }) });
    return count > 0;
  }

  async clearSeatRepair({ id, record }: { id: string; record: SeatRepairRecord }): Promise<void> {
    await this.prisma.subscription.updateMany({
      where: sameRepair({ id, record }),
      data: NO_SEAT_REPAIR,
    });
  }

  async recordSeatRepairFailure({
    id,
    record,
    attempts,
    flaggedAt,
  }: {
    id: string;
    record: SeatRepairRecord;
    attempts: number;
    flaggedAt: Instant | null;
  }): Promise<void> {
    await this.prisma.subscription.updateMany({
      where: sameRepair({ id, record }),
      data: {
        seatRepairAttempts: attempts,
        seatRepairFlaggedAt: flaggedAt ? toDate(flaggedAt) : null,
      },
    });
  }

  async claimSeatLine({ id, leaseMs }: { id: string; leaseMs: number }): Promise<SeatLineClaim> {
    const token = generate("billing").toString();
    const now = nowInstant();
    const { count } = await this.prisma.subscription.updateMany({
      where: {
        id,
        OR: [{ seatLineLeaseUntil: null }, { seatLineLeaseUntil: { lte: toDate(now) } }],
      },
      data: {
        seatLineLeaseToken: token,
        seatLineLeaseUntil: toDate(now.add({ milliseconds: leaseMs })),
      },
    });
    return count === 1 ? { claimed: true, token } : { claimed: false };
  }

  async renewSeatLine({
    id,
    token,
    leaseMs,
  }: {
    id: string;
    token: string;
    leaseMs: number;
  }): Promise<boolean> {
    const now = nowInstant();
    const { count } = await this.prisma.subscription.updateMany({
      where: { id, seatLineLeaseToken: token, seatLineLeaseUntil: { gt: toDate(now) } },
      data: { seatLineLeaseUntil: toDate(now.add({ milliseconds: leaseMs })) },
    });
    return count === 1;
  }

  async releaseSeatLine({ id, token }: { id: string; token: string }): Promise<void> {
    await this.prisma.subscription.updateMany({
      where: { id, seatLineLeaseToken: token },
      data: { seatLineLeaseToken: null, seatLineLeaseUntil: null },
    });
  }
}

/** The subscription while `record` is still its pending repair. */
function sameRepair({ id, record }: { id: string; record: SeatRepairRecord }) {
  return {
    id,
    seatRepairQuantity: record.quantity,
    seatRepairLiftedQuantity: record.liftedQuantity,
    seatRepairSince: toDate(record.since),
  };
}
