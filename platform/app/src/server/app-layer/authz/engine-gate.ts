/**
 * The one question the whole authorization surface forks on: has this
 * organization finished its migration onto the engine?
 *
 * ADR-110 — finishing the migration IS the switch. There is no separate
 * cutover record and no flip afterwards, so one gate serves every fork: the
 * permission seams in `rbac.ts` and `role-binding-resolver.ts`, the
 * collector's read repository, and the grant write path. "On" means on
 * everywhere at once, and the read and write halves can never answer for
 * different heads mid-request.
 *
 * This replaces two gates that asked the same question through different
 * tables (`AuthzCutoverProjection` and `SystemMigrationTenantState`), with
 * two caches, two TTLs and two failure directions between them.
 *
 * Browser-safety: no module-scope Prisma or Redis — the caller hands in its
 * client, so `rbac.ts` stays importable for its enums.
 */
import type { MigrationTenantStatus } from "@langwatch/authz-server";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "./migration-name";
import { authzEngineGateReadFailuresTotal } from "./metrics";
import { perOrganizationCachedFlag } from "./per-organization-cached-gate";

const logger = createLogger("langwatch:authz:engine-gate");

/**
 * The statuses that mean this organization's whole grant history is in the
 * event log and its projection is fed — so the engine can both answer and be
 * written to. Anything else (absent, pending, parked) means the history is
 * not there, and the organization stays on the legacy path.
 */
const ON_ENGINE_STATUSES: readonly MigrationTenantStatus[] = [
  "migrated",
  "finalized",
];

/**
 * One bound for both directions. The negative one is what lets a finishing
 * migration take effect fleet-wide with no deploy; the positive one only
 * matters if an operator reverts a status by hand, which is an incident
 * action rather than a designed lever — the switch is one-way by design.
 */
export const ENGINE_GATE_CACHE_TTL_MS = 60_000;

const gate = perOrganizationCachedFlag({
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
    logger.warn(
      { organizationId, error, ttlMs: ENGINE_GATE_CACHE_TTL_MS },
      "could not read the authz migration state; this organization stays on the legacy path until the cache expires",
    );
    authzEngineGateReadFailuresTotal.inc();
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
    organizationId,
    read: () => queryOrganizationOnAuthzEngine({ prisma, organizationId }),
  });
}

/**
 * Drop one organization's cached answer, so the next check re-reads. The
 * migration calls this the moment it finishes, which is what makes the
 * switch immediate on the pod that ran it; every other pod converges on the
 * TTL. Pod-local by design — cross-pod invalidation would need a bus and
 * would buy sixty seconds.
 */
export function invalidateAuthzEngineGate({
  organizationId,
}: {
  organizationId: string;
}): void {
  gate.invalidate({ organizationId });
}

/** The cache, dropped — for tests that migrate an organization mid-suite. */
export function resetAuthzEngineGateForTesting(): void {
  gate.resetForTesting();
}
