import type { TenantSource } from "@langwatch/system-migrations";
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * The users the heal leg of the bridge mirror could possibly concern
 * (ADR-116 §4), rather than every user there is.
 *
 * The heal never finalizes a user — while both branches can still write a
 * secret there is no state in which one can no longer need repairing — so the
 * runner never treats a healed user as terminal and re-proves everyone this
 * source hands it, on every pass, forever. Enumerating the whole `User` table
 * therefore costs a Redis claim, a state read, an `Account` read and a state
 * write PER USER PER PASS, and the boot preflight has to complete two passes
 * before a process may serve. On a fleet of a few thousand users that ran
 * past the startup probe's budget and no pod ever bound its port.
 *
 * So the enumeration carries the condition instead. A user needs the heal
 * only where one of their `Account` rows is ahead of the `AccountCredential`
 * row that mirrors it — either because no credential row exists yet (the
 * carry has not run) or because the legacy branch wrote a secret after the
 * copy (the heal proper). That is exactly the comparison
 * `IdentitySecretCarryService` makes per account, lifted to the question of
 * which users to visit at all, so a pass visits the drifted few and settles.
 *
 * Raw SQL because the predicate compares a column against a column on a
 * RELATED row, which Prisma's filter language cannot express; `id` is the
 * pinned account id, shared by both tables, so the join needs nothing else.
 * `Account` and `AccountCredential` are identity tables under the
 * multitenancy middleware's exemption — neither model has a `projectId`, so
 * neither carries one here.
 */
export class PrismaSecretHealTenantSource implements TenantSource {
  constructor(private readonly prisma: PrismaClient) {}

  async findTenantIdsAfter({
    cursor,
    limit,
  }: {
    cursor: string | null;
    limit: number;
  }): Promise<string[]> {
    // DISTINCT because a user with several drifted accounts is still one
    // tenant, and the runner claims per tenant.
    //
    // The `@tenancy` opt-out is required and correct: this asks "which users
    // does the heal have work for?" across the whole installation, which is
    // what a tenant source is for — the answer IS the tenant list, so it
    // cannot be scoped by one. `Account` and `AccountCredential` are identity
    // tables with no `projectId` or `organizationId` to scope it by in any
    // case, which is why both sit under the multitenancy exemption.
    const rows = await this.prisma.$queryRaw<{ userId: string }[]>`
      -- @tenancy: the tenant source itself; an installation-wide scan of two
      -- identity tables that carry no project or organization of their own
      SELECT DISTINCT a."userId"
      FROM "Account" a
      LEFT JOIN "AccountCredential" c ON c."id" = a."id"
      WHERE (c."id" IS NULL OR c."updatedAt" < a."updatedAt")
        AND (${cursor}::text IS NULL OR a."userId" > ${cursor}::text)
      ORDER BY a."userId" ASC
      LIMIT ${limit}::int
    `;
    return rows.map((row) => row.userId);
  }
}
