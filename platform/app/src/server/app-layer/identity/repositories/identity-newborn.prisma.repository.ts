import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../migration-name";

/**
 * The report a born-finalized state row carries (ADR-116 §3).
 *
 * It is what makes an abandoned entrance FINDABLE. The event store
 * enumerates no aggregates, and an entrance that died before its rows
 * committed staged no fold — so it leaves no `Identifier` row and no `User`
 * row either. Without a claim written before the append, the orphaned stream
 * would be invisible to any sweep, and ADR-116 §3 calls the sweep a required
 * companion rather than optional hygiene.
 */
export const IDENTITY_BORN_REPORT_KIND = "born" as const;

/** One newborn tenant whose facts landed and whose rows never did. */
export interface AbandonedNewborn {
  userId: string;
  claimedAt: Date;
}

/**
 * The row writes the born-finalized entrance performs, and the sweep that
 * cleans up after the ones that never happened.
 *
 * These are identity tables under the multitenancy middleware's
 * Identifier/Account exemption: `User`, `AccountCredential` and
 * `SystemMigrationTenantState` are not project-scoped, so none of these
 * queries carries a `projectId`.
 */
export class PrismaIdentityNewbornRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Stake the newborn's tenant BEFORE the append, so an entrance that fails
   * between the append and the row commit leaves something the sweep can
   * find. `migrated` and not `finalized`: the history is going into the log,
   * but nothing has proven it, and only `finalized` opens the write gate.
   *
   * The user tenant source enumerates `User` rows, so a claim for a user who
   * never existed is never picked up by the migration runner — it sits inert
   * until the sweep removes it.
   */
  async claim({ userId }: { userId: string }): Promise<void> {
    await this.prisma.systemMigrationTenantState.upsert({
      where: {
        migrationName_tenantId: {
          migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
          tenantId: userId,
        },
      },
      create: {
        migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        tenantId: userId,
        status: "migrated",
        report: { kind: IDENTITY_BORN_REPORT_KIND },
      },
      update: {},
    });
  }

  /**
   * ADR-116 §3 leg two: ONE Postgres transaction over the newborn's row
   * writes. They can share one because they are one store, and sharing it is
   * what makes the newborn either wholly present or wholly absent — an
   * entrance that dies mid-leg must not leave a user row whose gate stays
   * shut forever.
   *
   * Idempotent on the pinned ids, because a retry re-executes every leg: the
   * user row is created only if the id is free, and the state row is flipped
   * to `finalized` rather than re-created.
   */
  async commitNewborn({
    userId,
    user,
  }: {
    userId: string;
    user: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id: userId } });
      const row =
        existing ??
        (await tx.user.create({
          // The canonical row better-auth built, verbatim. Every field its
          // `user` model carries is a real column, so an unknown key is a
          // better-auth change we have not accounted for — and failing the
          // flagged sign-up loudly is the right direction for a population
          // that is an allowlist.
          data: { ...user, id: userId } as Prisma.UserUncheckedCreateInput,
        }));
      await tx.systemMigrationTenantState.upsert({
        where: {
          migrationName_tenantId: {
            migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
            tenantId: userId,
          },
        },
        create: {
          migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
          tenantId: userId,
          status: "finalized",
          report: { kind: IDENTITY_BORN_REPORT_KIND },
        },
        update: {
          status: "finalized",
          report: { kind: IDENTITY_BORN_REPORT_KIND },
        },
      });
      return row as unknown as Record<string, unknown>;
    });
  }

  /**
   * Newborn tenants whose facts landed and whose user row never did, older
   * than the threshold. The age bound is what keeps the sweep off entrances
   * that are simply still in flight.
   */
  async findAbandoned({
    olderThan,
    limit,
  }: {
    olderThan: Date;
    limit: number;
  }): Promise<AbandonedNewborn[]> {
    const claims = await this.prisma.systemMigrationTenantState.findMany({
      where: {
        migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        status: "migrated",
        updatedAt: { lt: olderThan },
      },
      select: { tenantId: true, updatedAt: true },
      orderBy: { updatedAt: "asc" },
      take: limit,
    });
    if (claims.length === 0) return [];
    // A claim only names an abandoned stream when no user was ever created
    // under it. A HELD user — adopted by the backfill, proof disagreeing —
    // has the same status and must never be swept.
    const born = new Set(
      (
        await this.prisma.user.findMany({
          where: { id: { in: claims.map((claim) => claim.tenantId) } },
          select: { id: true },
        })
      ).map((row) => row.id),
    );
    return claims
      .filter((claim) => !born.has(claim.tenantId))
      .map((claim) => ({ userId: claim.tenantId, claimedAt: claim.updatedAt }));
  }

  /** The claim, once its stream has been erased. */
  async releaseClaim({ userId }: { userId: string }): Promise<void> {
    await this.prisma.systemMigrationTenantState.deleteMany({
      where: {
        migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        tenantId: userId,
        status: "migrated",
      },
    });
  }
}
