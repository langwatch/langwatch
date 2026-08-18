/**
 * The per-organization WRITE fork (ADR-092 decision 4: build dark, cut an
 * organization over all at once, never half). The gate ships CLOSED: in
 * every pod, on every organization, until that organization's genesis
 * import lands — a deploy of the ledger writer changes nothing on its own.
 *
 * The gate's question is the one fact that already means "this
 * organization's whole grant history is in the ledger": its
 * `SystemMigrationTenantState` row for the genesis import. `migrated` or
 * `finalized` means the ledger holds every existing grant as a fact, so it
 * can safely become the writer. An absent row, `pending`, `parked` (the
 * import failed and will be retried) or `rolled_back` (the operator's flip)
 * all mean the ledger does NOT hold the organization's history, and its
 * writes stay on the imperative path.
 *
 * Rollback is an ops action, not a deploy: writing `rolled_back` on the
 * org's state row puts it back on the imperative path fleet-wide within the
 * positive cache's TTL. Rows written imperatively while on the legacy side
 * are ADOPTED by the next genesis pass (the import takes the legacy row's
 * own id as the fact's id), which is what makes flip → rollback → re-flip
 * safe rather than a divergence each time.
 *
 * Modelled on ./legacy-fallback-gate.ts (same shape of question for the
 * READ fork: short-TTL in-process cache, fail-safe direction, test seam).
 * Server-only, like ./ledger.ts, its only production caller — it defaults
 * to the app's Prisma singleton so verbs need not thread a client.
 */
import type { LedgerMigrationStatus } from "@langwatch/authz-server";
import { GRANTS_GENESIS_IMPORT_MIGRATION_NAME } from "@langwatch/authz-server/migration";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { prisma as appPrisma } from "../../db";

const logger = createLogger("langwatch:authz:ledger-write-gate");

/**
 * The statuses that mean the ledger holds this organization's grant history.
 * `migrated` is enough: the facts are in, the projection is fed, and the
 * writer may emit. Finalization is about the READ fork (decision-level
 * parity), which is a later and separate question.
 */
const LEDGER_WRITE_STATUSES: readonly LedgerMigrationStatus[] = [
  "migrated",
  "finalized",
];

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
    // `status` is a plain Prisma string column (no DB enum), wider than the
    // union the array is pinned to on purpose (see the type above) - the
    // cast is on this comparison, not on the declaration a rename must
    // still catch.
    onLedger =
      record !== null &&
      (LEDGER_WRITE_STATUSES as readonly string[]).includes(record.status);
  } catch (error) {
    // Fail safe: an unreadable state table leaves the organization on the
    // imperative path, which is today's behaviour and always works. Caching
    // that miss briefly keeps an outage from putting a read in front of every
    // grant write, and it can only ever delay a cutover, never extend one.
    //
    // Said out loud, because the failure is otherwise perfectly silent: a
    // migrated organization pinned back onto the legacy writer for the cache
    // TTL looks exactly like one that never migrated, and the only trace it
    // leaves is grant rows written imperatively for an organization the
    // operator believes is on the ledger.
    logger.warn(
      { organizationId, error, ttlMs: NEGATIVE_CACHE_TTL_MS },
      "could not read the genesis-import state; this organization's grant writes stay on the legacy path until the cache expires",
    );
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
