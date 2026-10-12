import { prismaTables, skipTenantCheck } from "@langwatch/prisma-client";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, type Instant, nowInstant, toDate } from "@langwatch/time";

import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../../rules/identity-migration-names.rules.ts";
import { isOnIdentifierPath } from "../../rules/identity-sign-in-switch.rules.ts";
import { IdentityLatchRepository } from "../identity-latch.repository.ts";

type SwitchRows = {
  ownOnIdentifiers: boolean | null;
  ownSwitchedAt: Date | null;
  legacyStatus: string | null;
  legacyOccurredAt: Date | null;
};

/**
 * Whether a user is proven: identity's `IdentitySignInSwitch` row beside the state row older
 * images still write, the newer answering (modules/identity/specs/sign-in-switch.feature).
 * Rollback pins `rolled_back`, which a write never overrides.
 */
export class PrismaIdentityLatchRepository extends IdentityLatchRepository {
  static readonly tables = prismaTables("IdentitySignInSwitch");

  static create(database: PrismaClient): PrismaIdentityLatchRepository {
    return new PrismaIdentityLatchRepository(database);
  }

  private constructor(private readonly database: PrismaClient) {
    super();
  }

  /**
   * Has ANY user finished the backfill? Asked first: while no, the per-user lookup is pure cost
   * on every request. Either side answering yes is enough; the per-user read decides the rest.
   */
  async hasAnyoneFinalized(): Promise<boolean> {
    const [row] = await this.database.$queryRaw<{ anyone: boolean }[]>`
      ${skipTenantCheck({
        // Asks whether any user at all is proven; no tenant is involved.
        SKIP_TENANT_CHECK: true,
      })}
      SELECT EXISTS (SELECT 1 FROM "IdentitySignInSwitch" WHERE "onIdentifiers")
          OR EXISTS (SELECT 1 FROM "SystemMigrationTenantState"
                      WHERE "migrationName" = ${IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME}
                        AND "status" = 'finalized') AS "anyone"
    `;
    return row?.anyone === true;
  }

  /** Whether THIS user's identifiers are the truth about their addresses. */
  async isFinalized({ userId }: { userId: string }): Promise<boolean> {
    const [row] = await this.database.$queryRaw<SwitchRows[]>`
      ${skipTenantCheck({
        // Both rows are keyed by the user itself.
        SKIP_TENANT_CHECK: true,
      })}
      SELECT w."onIdentifiers" AS "ownOnIdentifiers", w."switchedAt" AS "ownSwitchedAt",
             s."status" AS "legacyStatus", s."occurredAt" AS "legacyOccurredAt"
        FROM (SELECT ${userId}::text AS "id") u
        LEFT JOIN "IdentitySignInSwitch" w ON w."userId" = u."id"
        LEFT JOIN "SystemMigrationTenantState" s
          ON s."migrationName" = ${IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME} AND s."tenantId" = u."id"
    `;
    return isOnIdentifierPath(signInSwitchRows(row));
  }

  /**
   * An arrival adopted this user. The state row first, so an older image reading it agrees; then
   * identity's own row at the same time, so a rollback that lands between the two still wins.
   */
  async recordFinalized({ userId, report }: { userId: string; report: unknown }): Promise<void> {
    const occurredAt = toDate(nowInstant());
    if (!(await this.recordLegacyFinalized({ userId, report, occurredAt }))) return;
    await this.database.$executeRaw`
      ${skipTenantCheck({
        // Keyed by the user itself.
        SKIP_TENANT_CHECK: true,
      })}
      INSERT INTO "IdentitySignInSwitch" ("userId", "onIdentifiers", "pinned", "switchedAt", "updatedAt")
      VALUES (${userId}, true, false, ${occurredAt}, now())
      ON CONFLICT ("userId") DO UPDATE
         SET "onIdentifiers" = true, "switchedAt" = EXCLUDED."switchedAt", "updatedAt" = now()
       WHERE NOT "IdentitySignInSwitch"."pinned"
    `;
  }

  async recordProven({ userId, at }: { userId: string; at: Instant }): Promise<boolean> {
    const written = await this.database.$executeRaw`
      ${skipTenantCheck({
        // Both rows are keyed by the user itself.
        SKIP_TENANT_CHECK: true,
      })}
      INSERT INTO "IdentitySignInSwitch" ("userId", "onIdentifiers", "pinned", "switchedAt", "updatedAt")
      SELECT ${userId}, true, false, ${toDate(at)}, now()
       WHERE NOT EXISTS (SELECT 1 FROM "SystemMigrationTenantState"
                          WHERE "migrationName" = ${IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME}
                            AND "tenantId" = ${userId}
                            AND "status" = 'rolled_back')
      ON CONFLICT ("userId") DO UPDATE
         SET "onIdentifiers" = true, "switchedAt" = EXCLUDED."switchedAt", "updatedAt" = now()
       WHERE NOT "IdentitySignInSwitch"."pinned"
    `;
    return written > 0;
  }

  async pinSignInSwitch({
    userId,
    at,
    eventId,
  }: {
    userId: string;
    at: Instant;
    eventId: string;
  }): Promise<void> {
    await this.database.$executeRaw`
      ${skipTenantCheck({
        // Keyed by the user itself.
        SKIP_TENANT_CHECK: true,
      })}
      INSERT INTO "IdentitySignInSwitch"
        ("userId", "onIdentifiers", "pinned", "switchedAt", "lastAppliedEventId", "updatedAt")
      VALUES (${userId}, false, true, ${toDate(at)}, ${eventId}, now())
      ON CONFLICT ("userId") DO UPDATE
         SET "onIdentifiers" = false,
             "pinned" = true,
             "switchedAt" = GREATEST("IdentitySignInSwitch"."switchedAt", EXCLUDED."switchedAt"),
             "lastAppliedEventId" = EXCLUDED."lastAppliedEventId",
             "updatedAt" = now()
    `;
  }

  /** The runner's own guard: a write parked on the pin's row lock re-checks it, so SQL. */
  private async recordLegacyFinalized({
    userId,
    report,
    occurredAt,
  }: {
    userId: string;
    report: unknown;
    occurredAt: Date;
  }): Promise<boolean> {
    const reportJson = report == null ? null : JSON.stringify(report);
    const updated = await this.database.$executeRaw`
      ${skipTenantCheck({
        // Keyed by (migrationName, tenantId); the tenant is the key itself.
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "SystemMigrationTenantState"
         SET "status" = 'finalized',
             "report" = ${reportJson}::jsonb,
             "occurredAt" = ${occurredAt},
             "updatedAt" = now()
       WHERE "migrationName" = ${IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME}
         AND "tenantId" = ${userId}
         AND "status" <> 'rolled_back'
    `;
    if (updated > 0) return true;
    try {
      await this.database.systemMigrationTenantState.create({
        data: {
          migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
          tenantId: userId,
          status: "finalized",
          report: report == null ? Prisma.DbNull : (report as Prisma.InputJsonValue),
          occurredAt,
        },
      });
      return true;
    } catch (error) {
      // The row exists and the guarded update matched nothing: the pin wins.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
  }
}

/** Both sides of one user's switch, as the decision reads them. */
function signInSwitchRows(row: SwitchRows | undefined): Parameters<typeof isOnIdentifierPath>[0] {
  return {
    own:
      row?.ownOnIdentifiers != null && row.ownSwitchedAt
        ? { onIdentifiers: row.ownOnIdentifiers, switchedAt: fromDate(row.ownSwitchedAt) }
        : null,
    legacy:
      row?.legacyStatus != null && row.legacyOccurredAt
        ? { status: row.legacyStatus, occurredAt: fromDate(row.legacyOccurredAt) }
        : null,
  };
}
