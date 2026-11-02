import { skipTenantCheck } from "@langwatch/prisma-client";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

import { type SeatKind, seatKindSchema } from "../../rules/seat-holder.rules.ts";
import { type SeatPeakHolderRow, seatPeakWrites } from "../../rules/seat-peak-writes.rules.ts";
import { emptySeatPeak, type SeatPeakState } from "../../rules/seat-peak.rules.ts";
import {
  OrganizationSeatPeakRepository,
  type SeatPeakSlice,
} from "../organization-seat-peak.repository.ts";

type HolderRow = Prisma.OrganizationSeatPeakHolderGetPayload<object>;

/** A stored seat that is not a seat kind throws: read as none, it would skew every count. */
function seatOf(row: HolderRow): SeatKind {
  const seat = seatKindSchema.safeParse(row.seat);
  if (!seat.success) {
    throw new Error(
      `organization ${row.organizationId}'s seat-peak holder ${row.holderId} holds an unknown seat "${row.seat}"; rebuild the seat peak`,
    );
  }
  return seat.data;
}

function holderWhere({
  organizationId,
  holders,
}: Pick<SeatPeakSlice, "organizationId" | "holders">): Prisma.OrganizationSeatPeakHolderWhereInput {
  if (holders === "seated") return { organizationId, seat: { not: "none" } };
  return {
    organizationId,
    OR: holders.map((holder) =>
      holder.kind === "member"
        ? { holderKind: "member", holderId: holder.userId }
        : { holderKind: "invitation", holderId: holder.inviteId },
    ),
  };
}

function holderData(row: SeatPeakHolderRow) {
  return {
    seat: row.holding.seat,
    lastChangedAt: row.holding.lastChangedAt,
    lastChangeId: row.holding.lastChangeId ?? null,
    expiresAt: row.kind === "invitation" ? row.holding.expiresAt : null,
    expiredByFold: row.kind === "invitation" ? row.holding.expiredByFold === true : false,
  };
}

/** Waiting on another fold of the same organization counts against this; Prisma's 5s is short. */
const SEAT_PEAK_FOLD_TIMEOUT_MS = 60_000;
const SEAT_PEAK_FOLD_MAX_WAIT_MS = 10_000;

/** The seat peak's counts, holder and month rows in Postgres (ADR-002 §2). */
export class PrismaOrganizationSeatPeakRepository extends OrganizationSeatPeakRepository {
  static create(prisma: PrismaClient): PrismaOrganizationSeatPeakRepository {
    return new PrismaOrganizationSeatPeakRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async getState(slice: SeatPeakSlice): Promise<SeatPeakState> {
    return this.#load({ database: this.prisma, slice });
  }

  async update(slice: SeatPeakSlice, fold: (state: SeatPeakState) => SeatPeakState): Promise<void> {
    await this.prisma.$transaction(
      async (transaction) => {
        // One fold per organization until commit: a second would load the slice before this writes.
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`organization-seat-peak:${slice.organizationId}`}, 0)) ${skipTenantCheck(
          {
            // A lock, not a read; its key is itself one organization's.
            SKIP_TENANT_CHECK: true,
          },
        )}`;
        const before = await this.#load({ database: transaction, slice });
        await this.#write({
          transaction,
          organizationId: slice.organizationId,
          before,
          after: fold(before),
        });
      },
      { timeout: SEAT_PEAK_FOLD_TIMEOUT_MS, maxWait: SEAT_PEAK_FOLD_MAX_WAIT_MS },
    );
  }

  async #load({
    database,
    slice,
  }: {
    database: PrismaClient | Prisma.TransactionClient;
    slice: SeatPeakSlice;
  }): Promise<SeatPeakState> {
    const { organizationId } = slice;
    const counts = await database.organizationSeatPeak.findUnique({ where: { organizationId } });
    if (counts === null) return emptySeatPeak();
    const named =
      slice.holders === "seated" || slice.holders.length > 0
        ? await database.organizationSeatPeakHolder.findMany({ where: holderWhere(slice) })
        : [];
    const due = await database.organizationSeatPeakHolder.findMany({
      where: {
        organizationId,
        holderKind: "invitation",
        seat: { not: "none" },
        expiresAt: { lt: Math.max(slice.dueBefore, counts.latestChangeAt) },
      },
    });
    const months = await database.organizationSeatPeakMonth.findMany({ where: { organizationId } });
    const state: SeatPeakState = {
      openedAt: counts.openedAt,
      counts: { full: counts.fullSeats, lite: counts.liteSeats, developer: counts.developerSeats },
      latestChangeAt: counts.latestChangeAt,
      mismatches: counts.mismatches,
      members: {},
      invitations: {},
      months: Object.fromEntries(
        months.map(({ month, organizationId: _organizationId, ...values }) => [month, values]),
      ),
    };
    for (const row of [...named, ...due]) {
      const holding = {
        seat: seatOf(row),
        lastChangedAt: row.lastChangedAt,
        ...(row.lastChangeId === null ? {} : { lastChangeId: row.lastChangeId }),
      };
      if (row.holderKind === "member") {
        state.members[row.holderId] = holding;
      } else {
        state.invitations[row.holderId] = {
          ...holding,
          expiresAt: row.expiresAt,
          ...(row.expiredByFold ? { expiredByFold: true } : {}),
        };
      }
    }
    return state;
  }

  async #write({
    transaction,
    organizationId,
    before,
    after,
  }: {
    transaction: Prisma.TransactionClient;
    organizationId: string;
    before: SeatPeakState;
    after: SeatPeakState;
  }): Promise<void> {
    const writes = seatPeakWrites({ before, after });
    if (writes.counts !== null) {
      const data = {
        openedAt: writes.counts.openedAt,
        fullSeats: writes.counts.counts.full,
        liteSeats: writes.counts.counts.lite,
        developerSeats: writes.counts.counts.developer,
        latestChangeAt: writes.counts.latestChangeAt,
        mismatches: writes.counts.mismatches,
      };
      await transaction.organizationSeatPeak.upsert({
        where: { organizationId },
        create: { organizationId, ...data },
        update: data,
      });
    }
    if (writes.createdHolders.length > 0) {
      await transaction.organizationSeatPeakHolder.createMany({
        data: writes.createdHolders.map((row) => ({
          organizationId,
          holderKind: row.kind,
          holderId: row.holderId,
          ...holderData(row),
        })),
      });
    }
    for (const row of writes.updatedHolders) {
      await transaction.organizationSeatPeakHolder.update({
        where: {
          organizationId_holderKind_holderId: {
            organizationId,
            holderKind: row.kind,
            holderId: row.holderId,
          },
        },
        data: holderData(row),
      });
    }
    for (const { month, values } of writes.months) {
      await transaction.organizationSeatPeakMonth.upsert({
        where: { organizationId_month: { organizationId, month } },
        create: { organizationId, month, ...values },
        update: values,
      });
    }
  }
}
