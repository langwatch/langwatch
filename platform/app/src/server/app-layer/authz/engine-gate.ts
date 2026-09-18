/**
 * Migration completion for compatibility writes and legacy API-key adoption.
 * Permission checks use the authz engine independently of migration status.
 */
import type { MigrationTenantStatus } from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { perSubjectCachedFlag } from "../_shared/per-subject-cached-gate";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "./migration-name";

/**
 * How a failed state read is reported. A no-op by default because this module
 * has to stay importable from the browser; the server composition installs the
 * real one at startup (`presets.ts`), and a test asserts it did — an
 * uninstalled reporter would make a reopened legacy-fallback window silent,
 * which is the failure this exists to surface.
 */
export type AuthzEngineGateFailureReporter = (args: {
  organizationId: string;
  error: unknown;
  ttlMs: number;
}) => void;

let reportReadFailure: AuthzEngineGateFailureReporter = () => undefined;

export function setAuthzEngineGateFailureReporter(
  reporter: AuthzEngineGateFailureReporter,
): void {
  reportReadFailure = reporter;
}

/**
 * Only `finalized` moves an organization onto the engine. `migrated` is the
 * HELD state (the runner's own contract): the work landed but the
 * migration's proof found the projection behind or disagreeing, and the ops
 * page promises the operator such an organization "stays on its legacy
 * path, behaving exactly as before". Reads from a half-fed projection would
 * deny access the customer holds; writes fork on this same predicate, and a
 * held organization's imperative legacy writes are what the next pass
 * restates, rekeys or revokes — that loop is how it heals into `finalized`.
 * Anything else (absent, pending, parked, rolled back) is legacy too.
 */
const ON_ENGINE_STATUSES: readonly MigrationTenantStatus[] = ["finalized"];

/**
 * One bound for both directions. The negative one is what lets a finishing
 * migration take effect fleet-wide with no deploy; the positive one only
 * matters if an operator reverts a status by hand, which is an incident
 * action rather than a designed lever — the switch is one-way by design.
 */
export const ENGINE_GATE_CACHE_TTL_MS = 60_000;

const gate = perSubjectCachedFlag({
  name: "authz-engine-gate",
  ttlMs: ENGINE_GATE_CACHE_TTL_MS,
});

type MigrationStatePrisma = Pick<PrismaClient, "systemMigrationTenantState">;

/**
 * The status read itself, uncached and UNCAUGHT — an unreadable state table
 * raises here.
 *
 * That matters for exactly one caller. Revocation must never come undone, so
 * it routes on a fresh read and treats a failed one as "on the engine": the
 * branch that writes both heads, which is harmless on a legacy organization
 * and the only correct answer on a migrated one. It cannot use the fail-safe
 * wrapper below, because a swallowed error there is indistinguishable from a
 * genuine "not migrated" and would route the revoke to the legacy branch
 * alone — compat row deleted, grant still live, access not actually taken
 * away. Everything else wants the wrapper.
 */
export async function readOrganizationOnAuthzEngine({
  prisma,
  organizationId,
}: {
  prisma: MigrationStatePrisma;
  organizationId: string;
}): Promise<boolean> {
  const record = await prisma.systemMigrationTenantState.findUnique({
    where: {
      migrationName_tenantId: {
        migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
        tenantId: organizationId,
      },
    },
    select: { status: true },
  });
  // `status` is a plain string column, wider than the union above on
  // purpose, so the cast sits on the comparison rather than on the
  // declaration a rename must still catch.
  return (
    record !== null &&
    (ON_ENGINE_STATUSES as readonly string[]).includes(record.status)
  );
}

/** The same read, failing safe: an unreadable state table leaves the
 *  organization on the legacy path, which always works. What a cache miss
 *  runs, and what the migration's own repository runs while awaiting the
 *  state it just wrote. */
export async function queryOrganizationOnAuthzEngine({
  prisma,
  organizationId,
}: {
  prisma: MigrationStatePrisma;
  organizationId: string;
}): Promise<boolean> {
  try {
    return await readOrganizationOnAuthzEngine({ prisma, organizationId });
  } catch (error) {
    // Said out loud because the failure is otherwise silent — a migrated
    // organization pinned back onto legacy for the cache TTL looks exactly
    // like one that never migrated.
    reportReadFailure({
      organizationId,
      error,
      ttlMs: ENGINE_GATE_CACHE_TTL_MS,
    });
    return false;
  }
}

export async function organizationOnAuthzEngine({
  prisma,
  organizationId,
}: {
  prisma: MigrationStatePrisma;
  organizationId: string;
}): Promise<boolean> {
  return gate.get({
    subject: organizationId,
    read: () => queryOrganizationOnAuthzEngine({ prisma, organizationId }),
  });
}

/**
 * Drop one organization's cached answer, so the next check re-reads. Intended
 * for a caller that has just changed the stored status and needs its own pod
 * to re-read it. Nothing calls it in production BY DESIGN: the migration
 * returns `finalized` before the runner persists the status, so a call from
 * there would re-cache the old answer; every pod — the finalizing one
 * included — converges on the TTL instead, the same sixty-second bound
 * ADR-110 documents for rollback. Pod-local — cross-pod invalidation would
 * need a bus and would buy sixty seconds.
 */
export function invalidateAuthzEngineGate({
  organizationId,
}: {
  organizationId: string;
}): void {
  gate.invalidate({ subject: organizationId });
}

/** The cache, dropped — for tests that migrate an organization mid-suite. */
export function resetAuthzEngineGateForTesting(): void {
  gate.resetForTesting();
}
