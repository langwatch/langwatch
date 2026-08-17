/**
 * The per-organization WRITE fork (ADR-092 decision 4: build dark, cut an
 * organization over all at once, never half).
 *
 * PR 2 moves every grant mutation onto the ledger. Shipping that as a
 * deploy-time switch would flip every organization on the same second, which
 * is precisely the all-at-once behaviour change the in-place doctrine
 * exists to avoid. So the code ships gated CLOSED: on production, in every
 * pod, doing nothing at all until an organization's genesis import lands.
 *
 * The gate's question is the one fact that already means "this organization's
 * whole grant history is in the ledger": its `SystemMigrationTenantState` row
 * for the genesis import. `migrated` or `finalized` means the ledger holds
 * every existing grant as a fact, so it can safely become the writer. An
 * absent row, `pending`, `parked` (the import failed and will be retried) or
 * `rolled_back` (the operator's flip) all mean the ledger does NOT hold the
 * organization's history, and its writes stay on the imperative path they
 * have always taken.
 *
 * Rollback is therefore an ops action, not a deploy: writing `rolled_back` on
 * the org's state row puts it back on the imperative path fleet-wide within
 * the positive cache's TTL. Rows written imperatively while an organization
 * is on the legacy side are ADOPTED by the next genesis pass — the import
 * takes the legacy row's own id as the fact's id, so a re-run is convergent
 * rather than duplicating — which is what makes flip → rollback → re-flip
 * safe rather than a divergence each time.
 *
 * Modelled on ./legacy-fallback-gate.ts, which asks the same shape of
 * question about the same table for the READ fork: same short-TTL in-process
 * cache, same fail-safe direction (an unreadable state table reads as "not
 * migrated", i.e. today's behaviour), same test seam.
 *
 * Placement: this module is server-only, like ./ledger.ts which is its only
 * production caller — it defaults to the app's Prisma singleton so the verbs
 * need not thread a client, and takes one for tests. The read gate next door
 * cannot do that (it is reached from browser-importable modules), which is
 * the only shape difference between the two.
 */
import { GRANTS_GENESIS_IMPORT_MIGRATION_NAME } from "@langwatch/authz-server/migration";
import type { PrismaClient } from "~/generated/prisma/client";
import { prisma as appPrisma } from "../../db";

/**
 * The statuses that mean the ledger holds this organization's grant history.
 * `migrated` is enough: the facts are in, the projection is fed, and the
 * writer may emit. Finalization is about the READ fork (decision-level
 * parity), which is a later and separate question.
 */
const LEDGER_WRITE_STATUSES: readonly string[] = ["migrated", "finalized"];

const NEGATIVE_CACHE_TTL_MS = 60_000;

/**
 * Positive answers expire too, for the same reason the read gate's do: the
 * documented rollback is an operator writing `rolled_back` on the row, and a
 * forever-cached positive would keep live pods emitting commands for an
 * organization that has been put back on the legacy path until the next
 * deploy. This bound makes the flip — in either direction — take effect
 * fleet-wide within a minute, with no restarts.
 */
const POSITIVE_CACHE_TTL_MS = 60_000;

/**
 * One entry per organization holding the last answer and the moment it stops
 * counting. A single map (rather than one per answer) keeps the two
 * directions from disagreeing and lets an expired entry be dropped on the
 * way past instead of accumulating for the life of the pod.
 */
const cached = new Map<string, { onLedger: boolean; expiresAt: number }>();

export async function isOrgOnLedgerWrites({
  organizationId,
  prisma = appPrisma,
}: {
  organizationId: string;
  prisma?: Pick<PrismaClient, "systemMigrationTenantState">;
}): Promise<boolean> {
  const entry = cached.get(organizationId);
  if (entry !== undefined) {
    if (Date.now() < entry.expiresAt) return entry.onLedger;
    cached.delete(organizationId);
  }

  let onLedger = false;
  try {
    const record = await prisma.systemMigrationTenantState.findUnique({
      where: {
        migrationName_tenantId: {
          migrationName: GRANTS_GENESIS_IMPORT_MIGRATION_NAME,
          tenantId: organizationId,
        },
      },
      select: { status: true },
    });
    onLedger = record !== null && LEDGER_WRITE_STATUSES.includes(record.status);
  } catch {
    // Fail safe: an unreadable state table leaves the organization on the
    // imperative path, which is today's behaviour and always works. Caching
    // that miss briefly keeps an outage from putting a read in front of every
    // grant write, and it can only ever delay a cutover, never extend one.
    onLedger = false;
  }

  cached.set(organizationId, {
    onLedger,
    expiresAt:
      Date.now() + (onLedger ? POSITIVE_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS),
  });
  return onLedger;
}

/** The cache, dropped — for tests that migrate an organization mid-suite. */
export function resetLedgerWriteGateForTests(): void {
  cached.clear();
}
