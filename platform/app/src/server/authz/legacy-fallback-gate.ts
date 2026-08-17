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
 * positive answer is cached forever, a negative one briefly, and the stale
 * direction of the negative cache is "fallback still consulted" - correct,
 * just not yet switched. Any storage error reads as "not finalized" for
 * the same reason.
 *
 * Browser-safety: same posture as ./shadow.ts - no module-scope Prisma or
 * Redis; the caller hands in its client. rbac.ts stays importable for its
 * enums.
 */
import { TEAM_USER_BACKFILL_MIGRATION_NAME } from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";

const NEGATIVE_CACHE_TTL_MS = 5 * 60_000;

const finalizedOrganizations = new Set<string>();
const lastMissAt = new Map<string, number>();

export async function legacyTeamFallbackDisabled({
  prisma,
  organizationId,
}: {
  prisma: Pick<PrismaClient, "systemMigrationTenantState">;
  organizationId: string;
}): Promise<boolean> {
  if (finalizedOrganizations.has(organizationId)) return true;
  const missedAt = lastMissAt.get(organizationId);
  if (
    missedAt !== undefined &&
    Date.now() - missedAt < NEGATIVE_CACHE_TTL_MS
  ) {
    return false;
  }
  try {
    const record = await prisma.systemMigrationTenantState.findUnique({
      where: {
        migrationName_tenantId: {
          migrationName: TEAM_USER_BACKFILL_MIGRATION_NAME,
          tenantId: organizationId,
        },
      },
      select: { status: true },
    });
    if (record?.status === "finalized") {
      finalizedOrganizations.add(organizationId);
      lastMissAt.delete(organizationId);
      return true;
    }
  } catch {
    // Fail safe: an unreadable state table leaves the fallback on, which
    // is today's behaviour.
  }
  lastMissAt.set(organizationId, Date.now());
  return false;
}

/** Both caches, dropped - for tests that finalize an org mid-suite. */
export function resetLegacyFallbackGateForTesting(): void {
  finalizedOrganizations.clear();
  lastMissAt.clear();
}
