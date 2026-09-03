import { IdentityEmailInUseError } from "@langwatch/identity-contract";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../../identity-migration-names";

/** Prisma's unique-constraint code, as the pinned-id race arrives. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}

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
   * The user already standing at a pinned id, if any.
   *
   * The entrance asks BEFORE it states anything, because the id is derived
   * from the normalized address and normalization strips plus-tags: a second
   * sign-up at `sam+x@acme.com` derives the id `sam@acme.com` was born under.
   * A pinned id is a convergence key for a retry of the same birth, never a
   * claim on a user who already exists, so an occupied one is refused rather
   * than adopted — and refused before the append, so the attach fact never
   * lands in the standing user's stream.
   */
  async tryFindUserAtPinnedId({ userId }: { userId: string }): Promise<{ id: string } | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
  }

  /**
   * ADR-116 §3 leg two: ONE Postgres transaction over the newborn's row
   * writes. They can share one because they are one store, and sharing it is
   * what makes the newborn either wholly present or wholly absent — an
   * entrance that dies mid-leg must not leave a user row whose gate stays
   * shut forever.
   *
   * Idempotent on the pinned ids, because a retry re-executes every leg: an
   * attempt that failed before this transaction left no user row, so the
   * retry creates the same one, and the state row is flipped to `finalized`
   * rather than re-created.
   *
   * A row already at the id is a COLLISION, never something to adopt: the
   * caller checked, so reaching this means two sign-ups for one normalized
   * address raced. `identity_email_in_use` is the same answer the loser would
   * have got a moment earlier.
   */
  async commitNewborn({
    userId,
    user,
  }: {
    userId: string;
    user: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.user
        .create({
          // The canonical row better-auth built, verbatim. Every field its
          // `user` model carries is a real column, so an unknown key is a
          // better-auth change we have not accounted for — and failing the
          // flagged sign-up loudly is the right direction for a population
          // that is an allowlist.
          data: { ...user, id: userId } as Prisma.UserUncheckedCreateInput,
        })
        .catch((error: unknown) => {
          if (isUniqueViolation(error)) {
            throw new IdentityEmailInUseError(
              "born_finalized: another sign-up took this address while this one was in flight",
            );
          }
          throw error;
        });
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
        // The report kind is part of the QUERY, not a filter over the page.
        // A held user carries the same `migrated` status under the same
        // migration, so a fleet with more held users than the page holds
        // would return a page of them forever and never reach an orphan.
        report: {
          path: ["kind"],
          equals: IDENTITY_BORN_REPORT_KIND,
        },
      },
      select: { tenantId: true, updatedAt: true },
      orderBy: { updatedAt: "asc" },
      take: limit,
    });
    if (claims.length === 0) return [];
    // A claim only names an abandoned stream when no user was ever created
    // under it. An entrance that committed its rows and was then rolled back
    // to `migrated` by an operator would otherwise be swept.
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
