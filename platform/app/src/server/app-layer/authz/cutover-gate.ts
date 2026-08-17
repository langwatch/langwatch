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
 * Browser-safety: same posture as ./legacy-fallback-gate.ts and ./shadow.ts -
 * no module-scope Prisma or Redis; the caller hands in its client. rbac.ts
 * stays importable for its enums.
 */
import type { PrismaClient } from "~/generated/prisma/client";

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
const CACHE_TTL_MS = 60_000;

/**
 * One entry per organization, holding the last answer and the moment it stops
 * counting. A single map (rather than one per answer) is what keeps the two
 * directions from disagreeing, and lets an expired entry be dropped on the way
 * past instead of accumulating for the life of the pod.
 */
const cached = new Map<string, { onEngine: boolean; expiresAt: number }>();

export async function cutoverOnEngine({
  prisma,
  organizationId,
}: {
  prisma: Pick<PrismaClient, "authzCutoverProjection">;
  organizationId: string;
}): Promise<boolean> {
  const entry = cached.get(organizationId);
  if (entry !== undefined) {
    if (Date.now() < entry.expiresAt) return entry.onEngine;
    cached.delete(organizationId);
  }
  let onEngine = false;
  try {
    const record = await prisma.authzCutoverProjection.findUnique({
      where: { organizationId },
      select: { onEngine: true },
    });
    onEngine = record?.onEngine === true;
  } catch {
    // Fail safe: an unreadable projection reads as "not cut over", which is
    // today's behaviour - the legacy path, with the engine shadowing it.
    // Caching that miss briefly is deliberate (it keeps an outage from putting
    // a read on every permission check) and it can only ever delay a cutover
    // taking effect, never extend one past its rollback.
    onEngine = false;
  }
  cached.set(organizationId, {
    onEngine,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return onEngine;
}

/** The cache, dropped - for tests that cut an org over mid-suite. */
export function resetCutoverGateForTesting(): void {
  cached.clear();
}
