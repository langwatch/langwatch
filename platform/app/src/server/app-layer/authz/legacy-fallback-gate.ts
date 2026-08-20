/**
 * The per-organization switch stage B's in-place migration flips
 * (specs/rbac/in-place-authz-migration.feature): once the TeamUser backfill
 * FINALIZED an organization - bindings written and the decision-level
 * parity proof clean - its legacy TeamUser fallback reads stop. Every
 * consumer of the legacy fallback asks HERE, so "off" means off everywhere
 * at once: the three rbac.ts fallback branches and the engine collector's
 * legacy rows (which keeps the shadow comparison in agreement with the
 * legacy path it wraps).
 *
 * Finalization is a one-way latch, which is what makes caching safe: a
 * positive answer is cached long but bounded (the documented stage B
 * rollback must land fleet-wide without a deploy - see
 * POSITIVE_CACHE_TTL_MS), a negative one briefly, and the stale direction
 * of the negative cache is "fallback still consulted" - correct, just not
 * yet switched.
 *
 * Caching, coalescing and the fail-safe/warn behaviour live in
 * ./per-organization-cached-gate.ts, shared with ./cutover-gate.ts; this
 * module supplies only the query and the TTLs.
 *
 * Browser-safety: same posture as ./shadow.ts - no module-scope Prisma or
 * Redis; the caller hands in its client. rbac.ts stays importable for its
 * enums.
 */
import { TEAM_USER_BACKFILL_MIGRATION_NAME } from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { perOrganizationCachedFlag } from "./per-organization-cached-gate";

const NEGATIVE_CACHE_TTL_MS = 5 * 60_000;

/**
 * Positive answers expire too - not because finalization wavers (it is a
 * one-way latch in normal operation), but because the documented ROLLBACK
 * for stage B is writing `rolled_back` on the org's state row. A
 * forever-cached positive would keep every live pod on the switched path
 * until the next deploy; this bound makes that rollback take effect
 * fleet-wide within fifteen minutes, no restarts.
 */
const POSITIVE_CACHE_TTL_MS = 15 * 60_000;

const gate = perOrganizationCachedFlag({
  name: "legacy-fallback-gate",
  positiveTtlMs: POSITIVE_CACHE_TTL_MS,
  negativeTtlMs: NEGATIVE_CACHE_TTL_MS,
});

export async function legacyTeamFallbackDisabled({
  prisma,
  organizationId,
}: {
  prisma: Pick<PrismaClient, "systemMigrationTenantState">;
  organizationId: string;
}): Promise<boolean> {
  return gate.get({
    organizationId,
    read: async () => {
      const record = await prisma.systemMigrationTenantState.findUnique({
        where: {
          migrationName_tenantId: {
            migrationName: TEAM_USER_BACKFILL_MIGRATION_NAME,
            tenantId: organizationId,
          },
        },
        select: { status: true },
      });
      return record?.status === "finalized";
    },
  });
}

/** The cache, dropped - for tests that finalize an org mid-suite. */
export function resetLegacyFallbackGateForTesting(): void {
  gate.resetForTesting();
}
