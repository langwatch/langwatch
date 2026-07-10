import { Prisma, type PrismaClient } from "@prisma/client";

import type { StorageSweepCursorRepository } from "./storage-sweep-cursor.repository";

/** Singleton row id — there is exactly one platform-wide sweep cursor. */
const CURSOR_ID = "storage-sweep";

export class PrismaStorageSweepCursorRepository
  implements StorageSweepCursorRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async claimHour({
    sealedHour,
  }: {
    sealedHour: Date;
  }): Promise<{ claimed: boolean }> {
    // CAS advance: only the update moving the cursor FORWARD wins; a
    // concurrent or repeat claim for the same (or an older) hour matches
    // zero rows.
    const advanced = await this.prisma.storageSweepCursor.updateMany({
      where: { id: CURSOR_ID, lastSweptSealedHour: { lt: sealedHour } },
      data: { lastSweptSealedHour: sealedHour },
    });
    if (advanced.count === 1) return { claimed: true };

    const exists = await this.prisma.storageSweepCursor.findUnique({
      where: { id: CURSOR_ID },
      select: { id: true },
    });
    if (exists) return { claimed: false };

    // First sweep ever: create the singleton; losing the create race means
    // another process claimed this hour.
    try {
      await this.prisma.storageSweepCursor.create({
        data: { id: CURSOR_ID, lastSweptSealedHour: sealedHour },
      });
      return { claimed: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { claimed: false };
      }
      throw error;
    }
  }

  async claimEntryDay({
    day,
  }: {
    day: Date;
  }): Promise<{ claimed: boolean; previousDay: Date | null }> {
    // Read-then-CAS: the update only wins if the cursor still holds the value
    // we read, so a concurrent claimer can't make us mis-report previousDay.
    const row = await this.prisma.storageSweepCursor.findUnique({
      where: { id: CURSOR_ID },
      select: { lastEntrySweptDay: true },
    });
    if (!row) return { claimed: false, previousDay: null };

    const previousDay = row.lastEntrySweptDay;
    if (previousDay && previousDay.getTime() >= day.getTime()) {
      return { claimed: false, previousDay };
    }

    const advanced = await this.prisma.storageSweepCursor.updateMany({
      where: { id: CURSOR_ID, lastEntrySweptDay: previousDay },
      data: { lastEntrySweptDay: day },
    });
    return { claimed: advanced.count === 1, previousDay };
  }
}
