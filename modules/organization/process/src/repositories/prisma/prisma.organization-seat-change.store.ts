import { PrismaProcessStore } from "@langwatch/eventing/server";
import { generate } from "@langwatch/ksuid";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { nowInstant } from "@langwatch/time";

import type { SeatChangeCause } from "../../eventing/seat-peak.events.ts";
import {
  movesAnInvitationExpiry,
  movesASeat,
  seatChangeAppend,
  seatKindOf,
} from "../../rules/seat-change.rules.ts";
import type { SeatHolder, SeatKind } from "../../rules/seat-holder.rules.ts";
import type { CountedSeatHold } from "../organization-seat.repository.ts";
import { PrismaOrganizationSeatRepository } from "./prisma.organization-seat.repository.ts";

/** One holder's seat on each side of a write, as the repository that made it knows them. */
type OrganizationSeatChange = {
  organizationId: string;
  holder: SeatHolder;
  from: SeatKind;
  to: SeatKind;
  cause: SeatChangeCause;
  actorUserId: string | null;
};

/** A write that may move one holder's seat, run inside the writer's own transaction. */
type SeatMovingWrite<T> = {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  cause: SeatChangeCause;
  actorUserId: string | null;
  write: () => Promise<T>;
};

/**
 * Organization's seat changes (ADR-002; precedent prisma.organization-audit.store.ts): a seat
 * is read in the writer's transaction by the seat repository's own rule, and the change is
 * appended through it, so it commits or rolls back with the write.
 */
export class PrismaOrganizationSeatChangeStore {
  static create({ database }: { database: PrismaClient }): PrismaOrganizationSeatChangeStore {
    return new PrismaOrganizationSeatChangeStore(database);
  }

  /** The last moment stamped in this process; the next stamp is always later (ADR-002 §7). */
  static #lastStampedAt = 0;

  #outbox: PrismaProcessStore | undefined;

  private constructor(private readonly database: PrismaClient) {}

  /**
   * Reads the member's seat and their seat hold, runs the write, reads both again and records
   * each move, a seat given back before one taken so a hold replacing a seat never peaks.
   */
  async movingMember<T>({
    userId,
    write,
    ...change
  }: SeatMovingWrite<T> & { userId: string }): Promise<T> {
    const before = await this.#personSeats({ ...change, userId });
    const result = await write();
    const after = await this.#personSeats({ ...change, userId });
    await this.#recordAll({
      transaction: change.transaction,
      changes: [
        { ...change, holder: { kind: "member", userId }, from: before.member, to: after.member },
        ...holdMoves({ change, userId, before: before.hold, after: after.hold }),
      ],
    });
    return result;
  }

  /** Runs a write that moves several people's seat holds and records each hold's move. */
  async movingHolds<T>({
    userIds,
    write,
    ...change
  }: SeatMovingWrite<T> & { userIds: readonly string[] }): Promise<T> {
    const before = await this.#holds({ ...change, userIds });
    const result = await write();
    const after = await this.#holds({ ...change, userIds });
    await this.#recordAll({
      transaction: change.transaction,
      changes: userIds.flatMap((userId) =>
        holdMoves({ change, userId, before: before.get(userId), after: after.get(userId) }),
      ),
    });
    return result;
  }

  /**
   * Reads the invitation's seat, runs the write, reads it again and records the move. A live
   * invitation whose expiry moved records its seat on both sides, so the fold keeps it longer.
   */
  async movingInvitation<T>({
    inviteId,
    write,
    ...change
  }: SeatMovingWrite<T> & { inviteId: string }): Promise<T> {
    const before = await this.#invitation({ ...change, inviteId });
    const holdsBefore = await this.#holds({ ...change, userIds: before.heldUserIds });
    const result = await write();
    const after = await this.#invitation({ ...change, inviteId });
    const userIds = [...new Set([...before.heldUserIds, ...after.heldUserIds])];
    const holdsAfter = await this.#holds({ ...change, userIds });
    const moved = { ...change, holder: after.holder, from: before.seat, to: after.seat };
    const holds = userIds.flatMap((userId) =>
      holdMoves({
        change,
        userId,
        before: holdsBefore.get(userId),
        after: holdsAfter.get(userId),
      }),
    );
    if (movesAnInvitationExpiry({ before, after })) {
      await this.#append({
        transaction: change.transaction,
        change: { ...moved, cause: "invited" },
      });
      await this.#recordAll({ transaction: change.transaction, changes: holds });
    } else {
      await this.#recordAll({ transaction: change.transaction, changes: [moved, ...holds] });
    }
    return result;
  }

  /** An invitation just written held nothing before; it takes the seat the rule gives it. */
  async newInvitation({
    inviteId,
    ...change
  }: Omit<SeatMovingWrite<void>, "write"> & { inviteId: string }): Promise<void> {
    const { holder, seat, heldUserIds } = await this.#invitation({ ...change, inviteId });
    const holds: OrganizationSeatChange[] = [];
    for (const userId of heldUserIds) {
      // Its person's hold counted until this invitation was written.
      const [before] = await this.#seats(change.transaction).findCountedHold({
        organizationId: change.organizationId,
        userId,
        ignoringInviteId: inviteId,
      });
      const [after] = await this.#seats(change.transaction).findCountedHold({
        organizationId: change.organizationId,
        userId,
      });
      holds.push(...holdMoves({ change, userId, before, after }));
    }
    await this.#recordAll({
      transaction: change.transaction,
      changes: [{ ...change, holder, from: "none", to: seat }, ...holds],
    });
  }

  /** Appends the change unless it moves no seat; its id and its moment are minted here. */
  async record({
    transaction,
    change,
  }: {
    transaction: Prisma.TransactionClient;
    change: OrganizationSeatChange;
  }): Promise<void> {
    if (!movesASeat(change)) return;
    await this.#append({ transaction, change });
  }

  async #append({
    transaction,
    change,
  }: {
    transaction: Prisma.TransactionClient;
    change: OrganizationSeatChange;
  }): Promise<void> {
    const id = generate("seatchange");
    this.#outbox ??= PrismaProcessStore.create({ database: this.database });
    await this.#outbox.appendIntents({
      ...seatChangeAppend({
        change: {
          tenantId: change.organizationId,
          organizationId: change.organizationId,
          holder: change.holder,
          from: change.from,
          to: change.to,
          cause: change.cause,
          actorUserId: change.actorUserId,
          occurredAt: PrismaOrganizationSeatChangeStore.#stamp(),
          changeId: id.toString(),
        },
      }),
      transaction,
    });
  }

  /** Millisecond time, strictly increasing per call: two changes in one write keep their order. */
  static #stamp(): number {
    const stamped = Math.max(
      nowInstant().epochMilliseconds,
      PrismaOrganizationSeatChangeStore.#lastStampedAt + 1,
    );
    PrismaOrganizationSeatChangeStore.#lastStampedAt = stamped;
    return stamped;
  }

  /** Records each change that moves a seat, those giving a seat back first. */
  async #recordAll({
    transaction,
    changes,
  }: {
    transaction: Prisma.TransactionClient;
    changes: readonly OrganizationSeatChange[];
  }): Promise<void> {
    const ordered = changes.toSorted((a, b) => Number(a.to !== "none") - Number(b.to !== "none"));
    for (const change of ordered) await this.record({ transaction, change });
  }

  #seats(transaction: Prisma.TransactionClient): PrismaOrganizationSeatRepository {
    return PrismaOrganizationSeatRepository.create(transaction);
  }

  /** The person's member seat and their counted hold, read together. */
  async #personSeats({
    transaction,
    organizationId,
    userId,
  }: {
    transaction: Prisma.TransactionClient;
    organizationId: string;
    userId: string;
  }): Promise<{ member: SeatKind; hold: CountedSeatHold | undefined }> {
    const seats = this.#seats(transaction);
    const member = seatKindOf(await seats.findMemberSeat({ organizationId, userId }));
    const [hold] = await seats.findCountedHold({ organizationId, userId });
    return { member, hold };
  }

  async #holds({
    transaction,
    organizationId,
    userIds,
  }: {
    transaction: Prisma.TransactionClient;
    organizationId: string;
    userIds: readonly string[];
  }): Promise<Map<string, CountedSeatHold>> {
    const held = new Map<string, CountedSeatHold>();
    for (const userId of userIds) {
      const [hold] = await this.#seats(transaction).findCountedHold({ organizationId, userId });
      if (hold) held.set(userId, hold);
    }
    return held;
  }

  /**
   * The invitation as a holder and the seat it holds (`none` once settled or expired), and the
   * people whose seat hold its address names: a live full invitation takes such a hold's place.
   */
  async #invitation({
    transaction,
    organizationId,
    inviteId,
  }: {
    transaction: Prisma.TransactionClient;
    organizationId: string;
    inviteId: string;
  }): Promise<{ holder: SeatHolder; seat: SeatKind; heldUserIds: string[] }> {
    const seats = this.#seats(transaction);
    const row = await transaction.organizationInvite.findFirst({
      where: { id: inviteId, organizationId },
      select: { expiration: true, email: true },
    });
    return {
      heldUserIds: row?.email
        ? await seats.findHoldUserIdsByEmail({ organizationId, email: row.email })
        : [],
      holder: {
        kind: "invitation",
        inviteId,
        expiresAt: row?.expiration ? row.expiration.getTime() : null,
      },
      seat: seatKindOf(await seats.findInvitationSeat({ organizationId, inviteId })),
    };
  }
}

/** One person's counted hold before and after a write, as changes: none when it never held one. */
function holdMoves({
  change,
  userId,
  before,
  after,
}: {
  change: Omit<SeatMovingWrite<unknown>, "write" | "transaction">;
  userId: string;
  before: CountedSeatHold | undefined;
  after: CountedSeatHold | undefined;
}): OrganizationSeatChange[] {
  const heldUntil = after?.heldUntil ?? before?.heldUntil;
  if (heldUntil === undefined) return [];
  return [
    {
      organizationId: change.organizationId,
      cause: change.cause,
      actorUserId: change.actorUserId,
      holder: { kind: "hold", userId, expiresAt: heldUntil },
      from: before ? "full" : "none",
      to: after ? "full" : "none",
    },
  ];
}
