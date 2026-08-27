import type { DeclaredScopeId } from "@langwatch/authz";
import { IdentityMfaEnrollmentRequiredError } from "@langwatch/identity";
import type { OrganizationMfaService } from "../identity/organization-mfa.service";

/**
 * The enrollment gate, enforced on the way into an organization's data (D06,
 * follow-up 2).
 *
 * The screens already offer the setup when somebody is held; this is what
 * makes the gate ENFORCED rather than merely offered. A member who cannot
 * prove a second factor is refused at every procedure that reaches the
 * requiring organization's data, with `identity_mfa_enrollment_required` —
 * the code the enrollment-gate screen is registered against.
 *
 * Four properties, and each one is load-bearing:
 *
 *   - with two-step verification not offered on this deployment it does
 *     NOTHING, and it does nothing without asking anybody anything: the flag
 *     is the first line, so an install with it off pays not one extra query.
 *   - a personal scope is exempt. Nobody's own workspace is stranded by their
 *     employer's decision, and the exemption is checked here rather than
 *     trusted from a caller.
 *   - one person costs ONE query per request, not one per procedure call. The
 *     answers are memoized on the request context, which is what a tRPC batch
 *     of a dozen procedures shares.
 *   - it ends no session. There is no port on this module that could.
 */

/** The per-request memo. Lives on the tRPC context, which a batch shares. */
export interface MfaGateCache {
  /**
   * Where a scope sits: its organization, and whether it is personal.
   *
   * The PROMISE is memoized rather than its result, and so is the standing
   * below. A tRPC batch starts every procedure before the first read returns,
   * so caching the answer would mean a dozen concurrent misses and a dozen
   * queries — the exact thing this cache exists to prevent.
   */
  scopes: Map<string, Promise<ResolvedScopeOwner>>;
  /** Whether this person satisfies one organization's requirement. */
  standings: Map<string, Promise<void>>;
}

export function newMfaGateCache(): MfaGateCache {
  return { scopes: new Map(), standings: new Map() };
}

/** Which organization a scope belongs to, and whether it is somebody's own. */
export interface ResolvedScopeOwner {
  organizationId: string | null;
  isPersonal: boolean;
}

/** Where a scope sits. Implemented with Prisma; a port so this stays testable. */
export interface ScopeOwnershipPort {
  ownerOf(args: { scope: DeclaredScopeId }): Promise<ResolvedScopeOwner>;
}

export interface MfaGateDeps {
  /** Whether this deployment offers two-step verification at all. */
  offered: () => boolean;
  scopes: ScopeOwnershipPort;
  organizationMfa: () => OrganizationMfaService;
  cache: MfaGateCache;
}

/**
 * Refuse the request when the organization behind `scope` requires a second
 * factor this person cannot prove.
 *
 * Returns quietly in every other case, which is nearly all of them: the flag
 * off, a personal scope, a scope whose organization we cannot resolve, an
 * organization that requires nothing, and a member who can prove one.
 */
export async function assertSecondFactorSatisfied({
  deps,
  userId,
  sessionId,
  scope,
}: {
  deps: MfaGateDeps;
  userId: string;
  sessionId: string | undefined;
  scope: DeclaredScopeId;
}): Promise<void> {
  // The flag, first and before any read. With it off this function is a
  // boolean and a return, which is what "zero behaviour change" means here.
  if (!deps.offered()) return;

  const owner = await ownerOfScope({ deps, scope });
  if (owner.isPersonal) return;
  if (!owner.organizationId) return;

  await standingFor({
    deps,
    userId,
    sessionId,
    organizationId: owner.organizationId,
  });
}

function ownerOfScope({
  deps,
  scope,
}: {
  deps: MfaGateDeps;
  scope: DeclaredScopeId;
}): Promise<ResolvedScopeOwner> {
  // An organization scope names its own organization: no read at all, which
  // is the common case for the surfaces the requirement actually guards.
  if (scope.tier === "organization") {
    return Promise.resolve({ organizationId: scope.id, isPersonal: false });
  }
  const key = `${scope.tier}:${scope.id}`;
  const cached = deps.cache.scopes.get(key);
  if (cached) return cached;
  const pending = deps.scopes.ownerOf({ scope });
  deps.cache.scopes.set(key, pending);
  return pending;
}

/**
 * One person against one organization, asked once per request.
 *
 * The PROMISE is memoized rather than its result, so a batch of procedures
 * that all start before the first answer returns still costs one query
 * between them rather than one each.
 */
function standingFor({
  deps,
  userId,
  sessionId,
  organizationId,
}: {
  deps: MfaGateDeps;
  userId: string;
  sessionId: string | undefined;
  organizationId: string;
}): Promise<void> {
  const key = `${userId}:${organizationId}:${sessionId ?? ""}`;
  const cached = deps.cache.standings.get(key);
  if (cached) return cached;
  const pending = enforce({ deps, userId, sessionId, organizationId });
  deps.cache.standings.set(key, pending);
  return pending;
}

async function enforce({
  deps,
  userId,
  sessionId,
  organizationId,
}: {
  deps: MfaGateDeps;
  userId: string;
  sessionId: string | undefined;
  organizationId: string;
}): Promise<void> {
  const standing = await deps.organizationMfa().standingForSession({
    userId,
    organizationId,
    sessionId,
  });
  if (standing.satisfaction.satisfied) return;
  // The standing already carries the answer, so the refusal is thrown here
  // rather than by asking the service the same question a second time. Same
  // error either way: the code the enrollment-gate screen renders copy for.
  throw new IdentityMfaEnrollmentRequiredError(
    `organization ${organizationId} requires a second factor and ${userId} cannot yet prove one`,
  );
}
