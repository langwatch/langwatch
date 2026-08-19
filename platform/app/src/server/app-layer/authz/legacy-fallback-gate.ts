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

/**
 * Positive answers expire too - not because finalization wavers (it is a
 * one-way latch in normal operation), but because the documented ROLLBACK
 * for stage B is writing `rolled_back` on the org's state row. A
 * forever-cached positive would keep every live pod on the switched path
 * until the next deploy; this bound makes that rollback take effect
 * fleet-wide within fifteen minutes, no restarts.
 */
const POSITIVE_CACHE_TTL_MS = 15 * 60_000;

/**
 * One entry per organization, holding the last answer and the moment it
 * stops counting. A single map (rather than one per answer) is what keeps
 * the two directions from disagreeing, and lets an expired entry be dropped
 * on the way past instead of accumulating for the life of the pod.
 *
 * An organization that is only ever read once (a stale customer, a
 * decommissioned tenant) still leaves its entry in the map forever, since
 * nothing revisits it to notice it expired - so the map is additionally
 * bounded: writing a new entry amortized-sweeps expired entries once size
 * crosses `MAX_CACHE_ENTRIES`, and if it is still over the limit after that,
 * the oldest entries (by insertion order) are evicted until it is not.
 */
const cached = new Map<string, { disabled: boolean; expiresAt: number }>();

/** Hard cap on distinct organizations held at once; see `cached` above. */
export const MAX_CACHE_ENTRIES = 5_000;

/**
 * Amortized-sweep expired entries, then fall back to evicting the oldest
 * (by insertion order) until the map is back under the cap - see `cached`
 * above for why the map is bounded at all.
 */
function evictUntilUnderCap(): void {
  const now = Date.now();
  for (const [key, value] of cached) {
    if (value.expiresAt <= now) cached.delete(key);
  }
  while (cached.size >= MAX_CACHE_ENTRIES) {
    const oldestKey: string | undefined = cached.keys().next().value;
    if (oldestKey === undefined) break;
    cached.delete(oldestKey);
  }
}

function setCacheEntry(
  organizationId: string,
  entry: { disabled: boolean; expiresAt: number },
): void {
  if (cached.size >= MAX_CACHE_ENTRIES) evictUntilUnderCap();
  cached.set(organizationId, entry);
}

export async function legacyTeamFallbackDisabled({
  prisma,
  organizationId,
}: {
  prisma: Pick<PrismaClient, "systemMigrationTenantState">;
  organizationId: string;
}): Promise<boolean> {
  const entry = cached.get(organizationId);
  if (entry !== undefined) {
    if (Date.now() < entry.expiresAt) return entry.disabled;
    cached.delete(organizationId);
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
      setCacheEntry(organizationId, {
        disabled: true,
        expiresAt: Date.now() + POSITIVE_CACHE_TTL_MS,
      });
      return true;
    }
  } catch {
    // Fail safe: an unreadable state table leaves the fallback on, which is
    // today's behaviour. Caching that miss briefly is deliberate - it keeps
    // an outage from putting a read on every permission check - and it can
    // only ever delay switching a tenant off, never extend a switch.
  }
  setCacheEntry(organizationId, {
    disabled: false,
    expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS,
  });
  return false;
}

/** The cache, dropped - for tests that finalize an org mid-suite. */
export function resetLegacyFallbackGateForTesting(): void {
  cached.clear();
}
