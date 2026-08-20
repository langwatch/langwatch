/**
 * ADR-092 delivery-plan PR 3 — the per-organization cutover switch. Once the
 * cutover migration's parity proof came back clean for an organization, the
 * ledger's `cutover_completed` fact projects `onEngine = true` onto
 * `AuthzCutoverProjection`, and every fork in the request path asks HERE
 * whether this organization is served by the engine: the permission seams and
 * the collector's read repository alike, so "on" means on everywhere at once
 * and the two can never answer for different heads mid-request.
 *
 * Unlike stage B's finalization (a one-way latch), a cutover is REVERSIBLE by
 * design - see the TTL note below - so neither direction of the answer may be
 * cached forever.
 *
 * Caching, coalescing and the fail-safe/warn behaviour live in
 * ./per-organization-cached-gate.ts, shared with ./ledger-write-gate.ts;
 * this module supplies only the query and the TTL.
 *
 * Browser-safety: same posture as ./shadow.ts -
 * no module-scope Prisma or Redis; the caller hands in its client. rbac.ts
 * stays importable for its enums.
 */
import type { PrismaClient } from "~/generated/prisma/client";
import { perSubjectCachedFlag } from "../_shared/per-subject-cached-gate";

/**
 * Both directions expire on the same bound, and sixty seconds is what the
 * spec's two promises cost.
 *
 * The POSITIVE bound is the rollback lever's budget: rolling an organization
 * back sends `cutover_rolled_back` and writes `onEngine = false` on the
 * projection synchronously (delivery-plan decision 7), and this is the window
 * in which a fleet already holding a positive answer stops honouring it -
 * "permission checks in acme consult the legacy path within the gate's cache
 * window" (specs/rbac/in-place-authz-migration.feature).
 *
 * The NEGATIVE bound is what lets a COMPLETED cutover take effect fleet-wide
 * without a deploy: the pods that answered "legacy" for an organization while
 * its migration was still running pick the flip up on their next miss.
 *
 * Neither direction is safer than the other here, which is why there is one
 * constant rather than two: an organization mid-flip must converge in bounded
 * time whichever way it is moving.
 */
export const CUTOVER_GATE_CACHE_TTL_MS = 60_000;

const gate = perSubjectCachedFlag({
  name: "cutover-gate",
  positiveTtlMs: CUTOVER_GATE_CACHE_TTL_MS,
  negativeTtlMs: CUTOVER_GATE_CACHE_TTL_MS,
});

/**
 * The projection read itself, with no caching - what the gate's cache miss
 * runs, and what `findCutoverOnEngine` (the cutover migration's own
 * repository, awaiting the flip it just made) runs too. One query function so
 * the two can never drift onto different predicates.
 */
export async function queryCutoverOnEngine({
  prisma,
  organizationId,
}: {
  prisma: Pick<PrismaClient, "authzCutoverProjection">;
  organizationId: string;
}): Promise<boolean> {
  const record = await prisma.authzCutoverProjection.findUnique({
    where: { organizationId },
    select: { onEngine: true },
  });
  return record?.onEngine === true;
}

export async function cutoverOnEngine({
  prisma,
  organizationId,
}: {
  prisma: Pick<PrismaClient, "authzCutoverProjection">;
  organizationId: string;
}): Promise<boolean> {
  return gate.get({
    subject: organizationId,
    read: () => queryCutoverOnEngine({ prisma, organizationId }),
  });
}

/**
 * Drop ONE organization's cached answer, so the very next check re-reads the
 * projection. The rollback effect calls this straight after flipping
 * `onEngine` off, and the gate also marks any read still in flight stale, so
 * a read that started before the flip cannot re-cache "on engine" when it
 * settles. What remains is only the unavoidable sliver: callers already
 * coalesced onto that in-flight read get its pre-flip answer once - it is
 * never cached, and the next check re-reads the projection.
 *
 * Deliberately POD-LOCAL: this is a module map, so it invalidates the process
 * that calls it and nothing else. Every other pod converges on the TTL above,
 * which is the bound the spec already promises ("within the gate's cache
 * window"). Cross-pod invalidation would need a bus and would buy 60 seconds.
 */
export function invalidateCutoverGate({
  organizationId,
}: {
  organizationId: string;
}): void {
  gate.invalidate({ subject: organizationId });
}

/** The cache, dropped - for tests that cut an org over mid-suite. */
export function resetCutoverGateForTesting(): void {
  gate.resetForTesting();
}
