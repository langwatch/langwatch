import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaTables } from "@langwatch/prisma-client/ownership";
import { fromDate, type Instant, toDate } from "@langwatch/time";

import {
  type SeatHold,
  seatHoldReasonSchema,
  SeatHoldRepository,
} from "../seat-hold.repository.ts";

type PrismaSeatHoldDatabase = PrismaClient | Prisma.TransactionClient;

const SEAT_HOLD_SELECT = {
  organizationId: true,
  userId: true,
  email: true,
  name: true,
  seatTakenAt: true,
  heldUntil: true,
  reason: true,
} as const;

/** Seat holds over the `SeatHold` table organization owns. */
export class PrismaSeatHoldRepository extends SeatHoldRepository {
  static readonly tables = prismaTables("SeatHold");

  static create(prisma: PrismaSeatHoldDatabase): PrismaSeatHoldRepository {
    return new PrismaSeatHoldRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaSeatHoldDatabase) {
    super();
  }

  async findLiveForPerson({
    organizationId,
    userId,
    email,
    now,
  }: {
    organizationId: string;
    userId?: string;
    email?: string;
    now: Instant;
  }): Promise<SeatHold[]> {
    const who = [
      ...(userId ? [{ userId }] : []),
      ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
    ];
    if (who.length === 0) return [];
    const rows = await this.prisma.seatHold.findMany({
      where: { organizationId, heldUntil: { gt: toDate(now) }, OR: who },
      select: SEAT_HOLD_SELECT,
    });
    // The user id match first: the address only stands in for a person not yet known by id.
    return rows
      .map(toSeatHold)
      .toSorted((a, b) => Number(b.userId === userId) - Number(a.userId === userId));
  }

  async findLiveInOrganization({
    organizationId,
    now,
  }: {
    organizationId: string;
    now: Instant;
  }): Promise<SeatHold[]> {
    const rows = await this.prisma.seatHold.findMany({
      where: { organizationId, heldUntil: { gt: toDate(now) } },
      select: SEAT_HOLD_SELECT,
      orderBy: { heldUntil: "asc" },
    });
    return rows.map(toSeatHold);
  }

  async findOrganizationsWithEnded({ now }: { now: Instant }): Promise<string[]> {
    const rows = await this.prisma.seatHold.findMany({
      where: { heldUntil: { lte: toDate(now) } },
      select: { organizationId: true },
      distinct: ["organizationId"],
    });
    return rows.map((row) => row.organizationId);
  }

  async deleteEnded({
    organizationId,
    now,
  }: {
    organizationId: string;
    now: Instant;
  }): Promise<void> {
    await this.prisma.seatHold.deleteMany({
      where: { organizationId, heldUntil: { lte: toDate(now) } },
    });
  }
}

function toSeatHold(row: {
  organizationId: string;
  userId: string;
  email: string | null;
  name: string | null;
  seatTakenAt: Date;
  heldUntil: Date;
  reason: string;
}): SeatHold {
  return {
    ...row,
    seatTakenAt: fromDate(row.seatTakenAt),
    heldUntil: fromDate(row.heldUntil),
    reason: seatHoldReasonSchema.parse(row.reason),
  };
}
