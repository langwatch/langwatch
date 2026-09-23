import {
  breakGlassIsLive,
  SsoBreakGlassLastWayInError,
  SsoConnectionActivationBlockedError,
  type BreakGlassBinding,
} from "@langwatch/identity-contract";
import type {
  Prisma,
  PrismaClient,
  SsoBreakGlassBinding as SsoBreakGlassBindingRow,
} from "@langwatch/prisma-client/generated";

import { SsoBreakGlassRepository } from "../sso-break-glass.repository.ts";

/** The models the ways back in are kept in, plus the transaction runner. */
export type PrismaSsoBreakGlassDatabase = PrismaClient;

type ActivationRecoveryReservationRow = {
  commandId: string;
  organizationId: string;
  connectionId: string;
};

/**
 * Refuse a revocation that would leave the organization with no way back in,
 * while an ACTIVE connection exists OR an activation is mid-flight — without
 * the second, two concurrent revocations remove the last two bindings.
 */
async function assertNotTheLastWayIn({
  tx,
  bindingId,
  organizationId,
  nowMs,
}: {
  tx: Prisma.TransactionClient;
  bindingId: string;
  organizationId: string;
  nowMs: number;
}): Promise<void> {
  const protectedConnection = await tx.ssoConnection.findFirst({
    where: { organizationId, state: "ACTIVE" },
    select: { id: true },
  });
  const pendingReservations = await tx.$queryRaw<{ commandId: string }[]>`
    SELECT "commandId"
    FROM "SsoActivationRecoveryReservation"
    WHERE "organizationId" = ${organizationId}
    LIMIT 1
  `;
  if (protectedConnection === null && pendingReservations.length === 0) return;

  const otherLive = await tx.ssoBreakGlassBinding.count({
    where: {
      organizationId,
      id: { not: bindingId },
      supersededAt: null,
      expiresAt: { gt: new Date(nowMs) },
    },
  });
  if (otherLive === 0) {
    throw new SsoBreakGlassLastWayInError(
      `binding ${bindingId} is organization ${organizationId}'s only live way back in while a connection is ACTIVE`,
    );
  }
}

/**
 * The ways back in, in Postgres (D05). Append-mostly: a grant and a renewal
 * both INSERT, and the only updates are the two fields that are not the grant
 * itself, which is what keeps a previous end date readable after a renewal.
 */
export class PrismaSsoBreakGlassRepository extends SsoBreakGlassRepository {
  /** Spends an activation's recovery reservation once the head it rests on is projected. */
  static async consumeReservationInTransaction(
    tx: Prisma.TransactionClient,
    args: { organizationId: string; connectionId: string; commandId: string },
  ): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "SsoActivationRecoveryReservation"
      WHERE "commandId" = ${args.commandId}
        AND "organizationId" = ${args.organizationId}
        AND "connectionId" = ${args.connectionId}
    `;
  }

  /** Clears a reservation only after the same transaction projected a terminal state. */
  static async cancelReservationInTransaction(
    tx: Prisma.TransactionClient,
    args: { organizationId: string; connectionId: string },
  ): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "SsoActivationRecoveryReservation" AS reservation
      USING "SsoConnection" AS connection
      WHERE reservation."organizationId" = ${args.organizationId}
        AND reservation."connectionId" = ${args.connectionId}
        AND connection."id" = reservation."connectionId"
        AND connection."organizationId" = reservation."organizationId"
        AND connection."state" IN ('DISCARDED', 'TORN_DOWN')
    `;
  }

  /** The same organization lock a reservation and a revocation take. */
  static async lockOrganizationInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<void> {
    await lockOrganization(tx, organizationId);
  }

  static create(database: PrismaSsoBreakGlassDatabase): PrismaSsoBreakGlassRepository {
    return new PrismaSsoBreakGlassRepository(database);
  }

  private constructor(private readonly database: PrismaSsoBreakGlassDatabase) {
    super();
  }

  async findAllForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<BreakGlassBinding[]> {
    const rows = await this.database.ssoBreakGlassBinding.findMany({
      where: { organizationId },
      orderBy: { grantedAt: "asc" },
    });

    return rows.map(rowToBinding);
  }

  async findById({ bindingId }: { bindingId: string }): Promise<BreakGlassBinding | null> {
    const row = await this.database.ssoBreakGlassBinding.findUnique({ where: { id: bindingId } });

    return row === null ? null : rowToBinding(row);
  }

  async create({ binding }: { binding: BreakGlassBinding }): Promise<void> {
    await this.database.ssoBreakGlassBinding.create({
      data: {
        id: binding.bindingId,
        organizationId: binding.organizationId,
        userId: binding.userId,
        grantedByUserId: binding.grantedByUserId,
        grantedAt: new Date(binding.grantedAtMs),
        expiresAt: new Date(binding.expiresAtMs),
        supersededAt: binding.supersededAtMs === null ? null : new Date(binding.supersededAtMs),
        renewedFromId: binding.renewedFromBindingId,
        warnedDays: binding.warnedDays,
      },
    });
  }

  /**
   * `updateMany` rather than `update`, so a renewal racing another renewal's
   * write lands as "nothing to supersede" instead of a raw P2025 the reader
   * cannot act on.
   */
  async markSuperseded({
    bindingId,
    supersededAtMs,
  }: {
    bindingId: string;
    supersededAtMs: number;
  }): Promise<void> {
    await this.database.ssoBreakGlassBinding.updateMany({
      where: { id: bindingId, supersededAt: null },
      data: { supersededAt: new Date(supersededAtMs) },
    });
  }

  async revokePreservingRecovery({
    bindingId,
    organizationId,
    nowMs,
  }: {
    bindingId: string;
    organizationId: string;
    nowMs: number;
  }): Promise<BreakGlassBinding> {
    return this.database.$transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      const row = await tx.ssoBreakGlassBinding.findUnique({ where: { id: bindingId } });
      if (row === null || row.organizationId !== organizationId) {
        throw new Error(
          `break-glass binding ${bindingId} is not one of organization ${organizationId}'s`,
        );
      }

      const binding = rowToBinding(row);
      if (!breakGlassIsLive({ binding, nowMs })) return binding;

      await assertNotTheLastWayIn({ tx, bindingId, organizationId, nowMs });

      const revoked = await tx.ssoBreakGlassBinding.update({
        where: { id: bindingId },
        data: { supersededAt: new Date(nowMs) },
      });

      return rowToBinding(revoked);
    });
  }

  async reserveActivationRecovery({
    organizationId,
    connectionId,
    commandId,
    nowMs,
  }: {
    organizationId: string;
    connectionId: string;
    commandId: string;
    nowMs: number;
  }): Promise<boolean> {
    return this.database.$transaction(async (tx) => {
      await lockOrganization(tx, organizationId);

      const existing = await tx.$queryRaw<ActivationRecoveryReservationRow[]>`
        SELECT "commandId", "organizationId", "connectionId"
        FROM "SsoActivationRecoveryReservation"
        WHERE "organizationId" = ${organizationId}
          AND ("commandId" = ${commandId} OR "connectionId" = ${connectionId})
      `;
      const repeated = existing.find(
        (reservation) =>
          reservation.commandId === commandId &&
          reservation.organizationId === organizationId &&
          reservation.connectionId === connectionId,
      );
      if (repeated === undefined && existing.length > 0) {
        throw new SsoConnectionActivationBlockedError(
          `connection ${connectionId}: recovery is already reserved by another activation`,
        );
      }

      const liveBindings = await tx.ssoBreakGlassBinding.count({
        where: { organizationId, supersededAt: null, expiresAt: { gt: new Date(nowMs) } },
      });
      if (liveBindings === 0) return false;
      if (repeated !== undefined) return true;

      await tx.$executeRaw`
        INSERT INTO "SsoActivationRecoveryReservation"
          ("commandId", "organizationId", "connectionId", "createdAt")
        VALUES (${commandId}, ${organizationId}, ${connectionId}, ${new Date(nowMs)})
      `;

      return true;
    });
  }

  async recordWarningsSent({
    bindingId,
    days,
  }: {
    bindingId: string;
    days: number[];
  }): Promise<void> {
    await this.database.ssoBreakGlassBinding.updateMany({
      where: { id: bindingId },
      data: { warnedDays: { push: days } },
    });
  }

  /**
   * The one read here that crosses organizations: warnings serve the whole
   * installation. `expiresAt > now` keeps an expired binding out — one that
   * ended while the worker was down is over, not owed a warning.
   */
  async findLiveExpiringBefore({
    beforeMs,
    nowMs,
    limit,
  }: {
    beforeMs: number;
    nowMs: number;
    limit: number;
  }): Promise<BreakGlassBinding[]> {
    const rows = await this.database.ssoBreakGlassBinding.findMany({
      where: {
        supersededAt: null,
        expiresAt: { gt: new Date(nowMs), lte: new Date(beforeMs) },
      },
      orderBy: { expiresAt: "asc" },
      take: limit,
    });

    return rows.map(rowToBinding);
  }
}

/**
 * `$executeRaw`, not `$queryRaw`: `pg_advisory_xact_lock` returns void, which
 * `$queryRaw` cannot deserialize.
 */
async function lockOrganization(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  await tx.$executeRaw`
    -- @tenancy: organization-scoped advisory lock keyed by the bound organization id
    SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))
  `;
}

function rowToBinding(row: SsoBreakGlassBindingRow): BreakGlassBinding {
  return {
    bindingId: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    grantedByUserId: row.grantedByUserId,
    grantedAtMs: row.grantedAt.getTime(),
    expiresAtMs: row.expiresAt.getTime(),
    supersededAtMs: row.supersededAt?.getTime() ?? null,
    renewedFromBindingId: row.renewedFromId,
    warnedDays: row.warnedDays,
  };
}
