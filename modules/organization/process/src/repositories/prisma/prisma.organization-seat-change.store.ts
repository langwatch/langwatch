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

  /** Reads the member's seat, runs the write, reads it again and records the move. */
  async movingMember<T>({
    userId,
    write,
    ...change
  }: SeatMovingWrite<T> & { userId: string }): Promise<T> {
    const from = await this.#memberSeat({ ...change, userId });
    const result = await write();
    const to = await this.#memberSeat({ ...change, userId });
    await this.record({
      transaction: change.transaction,
      change: { ...change, holder: { kind: "member", userId }, from, to },
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
    const result = await write();
    const after = await this.#invitation({ ...change, inviteId });
    const moved = { ...change, holder: after.holder, from: before.seat, to: after.seat };
    if (movesAnInvitationExpiry({ before, after })) {
      await this.#append({
        transaction: change.transaction,
        change: { ...moved, cause: "invited" },
      });
    } else {
      await this.record({ transaction: change.transaction, change: moved });
    }
    return result;
  }

  /** An invitation just written held nothing before; it takes the seat the rule gives it. */
  async newInvitation({
    inviteId,
    ...change
  }: Omit<SeatMovingWrite<void>, "write"> & { inviteId: string }): Promise<void> {
    const { holder, seat } = await this.#invitation({ ...change, inviteId });
    await this.record({
      transaction: change.transaction,
      change: { ...change, holder, from: "none", to: seat },
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

  async #memberSeat({
    transaction,
    organizationId,
    userId,
  }: {
    transaction: Prisma.TransactionClient;
    organizationId: string;
    userId: string;
  }): Promise<SeatKind> {
    const seats = PrismaOrganizationSeatRepository.create(transaction);
    return seatKindOf(await seats.findMemberSeat({ organizationId, userId }));
  }

  /** The invitation as a holder and the seat it holds; `none` once settled or expired. */
  async #invitation({
    transaction,
    organizationId,
    inviteId,
  }: {
    transaction: Prisma.TransactionClient;
    organizationId: string;
    inviteId: string;
  }): Promise<{ holder: SeatHolder; seat: SeatKind }> {
    const seats = PrismaOrganizationSeatRepository.create(transaction);
    const row = await transaction.organizationInvite.findFirst({
      where: { id: inviteId, organizationId },
      select: { expiration: true },
    });
    return {
      holder: {
        kind: "invitation",
        inviteId,
        expiresAt: row?.expiration ? row.expiration.getTime() : null,
      },
      seat: seatKindOf(await seats.findInvitationSeat({ organizationId, inviteId })),
    };
  }
}
