/**
 * Can any key in this organization actually spend against this budget?
 *
 * A budget only ever accrues when a completed request matches its scope.
 * The match is decided by GatewayBudgetRepository.applicableForRequest,
 * against scopes derived from the VK that served the request and from the
 * project its trace landed in, which for a key that is not scoped to
 * exactly one project is the organization's governance project, not the
 * project the key's team owns (see resolveTraceProject).
 *
 * That makes two reasonable-looking configurations silently inert: a
 * project-scoped budget and a team-scoped key never interact, and neither
 * side says so. This module replays the same matching rule against every
 * active key up front, so a budget that can never match anything can be
 * flagged at the moment someone looks at it rather than after a day of
 * traffic that accrued nothing.
 */
import type { GatewayBudget, PrismaClient } from "~/generated/prisma/client";

import { resolveTraceProject } from "./scopeResolver";

/**
 * The scopes one active key contributes. Mirrors ApplicableScopes, which is
 * what the fold builds per request.
 */
type KeyReach = {
  organizationId: string;
  teamId: string | null;
  projectId: string | null;
  virtualKeyId: string;
  principalUserId: string | null;
  /**
   * Groups the key's principal belongs to in this organization. Empty for a
   * key with no principal, which is what makes group budgets unreachable
   * through shared keys.
   */
  groupIds: string[];
};

export type BudgetScopeReach = {
  budgetId: string;
  /** False when no active key can produce traffic this budget matches. */
  reachable: boolean;
  /**
   * Where the organization's active keys do send traffic, so the caller can
   * say what would need to change. Empty when there are no active keys.
   */
  reachableProjectIds: string[];
};

/**
 * Resolve, once per organization, the scopes every active key can put on a
 * request. One `resolveTraceProject` call per key: keys are per-organization
 * and few, and the result is reused across every budget in the list. Group
 * membership is read for every principal in one query, so adding keys costs
 * no extra round-trips.
 */
async function loadKeyReach(
  prisma: PrismaClient,
  organizationId: string,
): Promise<KeyReach[]> {
  const keys = await prisma.virtualKey.findMany({
    where: { organizationId, status: "ACTIVE" },
    include: { scopes: true },
  });

  const groupIdsByPrincipal = await loadGroupIdsByPrincipal(
    prisma,
    organizationId,
    keys.map((key) => key.principalUserId),
  );

  const reach: KeyReach[] = [];
  for (const key of keys) {
    const traceProject = await resolveTraceProject(prisma, key);
    reach.push({
      organizationId: key.organizationId,
      teamId: traceProject?.teamId ?? null,
      projectId: traceProject?.id ?? null,
      virtualKeyId: key.id,
      principalUserId: key.principalUserId,
      groupIds: key.principalUserId
        ? (groupIdsByPrincipal.get(key.principalUserId) ?? [])
        : [],
    });
  }
  return reach;
}

/**
 * Group ids per principal, scoped to this organization so a user who also
 * belongs to a group elsewhere never makes another organization's group
 * budget look reachable here. Mirrors memberGroupIds in
 * budgetResolution.service, batched over the distinct principals.
 */
async function loadGroupIdsByPrincipal(
  prisma: PrismaClient,
  organizationId: string,
  principalUserIds: (string | null)[],
): Promise<Map<string, string[]>> {
  const byPrincipal = new Map<string, string[]>();
  const distinct = Array.from(
    new Set(
      principalUserIds.filter((id): id is string => typeof id === "string"),
    ),
  );
  if (distinct.length === 0) return byPrincipal;

  const memberships = await prisma.groupMembership.findMany({
    where: { userId: { in: distinct }, group: { organizationId } },
    select: { userId: true, groupId: true },
  });
  for (const membership of memberships) {
    const groupIds = byPrincipal.get(membership.userId);
    if (groupIds) groupIds.push(membership.groupId);
    else byPrincipal.set(membership.userId, [membership.groupId]);
  }
  return byPrincipal;
}

/** The same predicate applicableForRequest uses, evaluated in memory. */
function budgetMatchesKey(budget: GatewayBudget, key: KeyReach): boolean {
  switch (budget.scopeType) {
    case "ORGANIZATION":
      return budget.scopeId === key.organizationId;
    case "TEAM":
      return budget.scopeId === key.teamId;
    case "PROJECT":
      return budget.scopeId === key.projectId;
    case "VIRTUAL_KEY":
      return budget.scopeId === key.virtualKeyId;
    case "PRINCIPAL":
      return budget.scopeId === key.principalUserId;
    case "ATTRIBUTED_USER":
      // The template anchors on a virtual key or a project and applies to
      // every request on that anchor, whoever the end user turns out to be,
      // so a key reaches it by being the anchor or by tracing into it.
      return (
        budget.scopeId === key.virtualKeyId || budget.scopeId === key.projectId
      );
    case "GROUP":
      // Group budgets enforce per member, so only a key that carries a
      // principal reaches one, and only through that principal's groups.
      return key.groupIds.includes(budget.scopeId);
    default: {
      // Every scope type answers for itself here. Without this arm a scope
      // added to the enum falls through to "no key can reach it", which
      // reads in the UI as a warning on a budget that is enforcing.
      const _exhaustive: never = budget.scopeType;
      return false;
    }
  }
}

export async function resolveBudgetScopeReach(
  prisma: PrismaClient,
  organizationId: string,
  budgets: GatewayBudget[],
): Promise<Map<string, BudgetScopeReach>> {
  const out = new Map<string, BudgetScopeReach>();
  if (budgets.length === 0) return out;

  const keys = await loadKeyReach(prisma, organizationId);
  const reachableProjectIds = Array.from(
    new Set(
      keys
        .map((k) => k.projectId)
        .filter((id): id is string => typeof id === "string"),
    ),
  );

  for (const budget of budgets) {
    out.set(budget.id, {
      budgetId: budget.id,
      reachable: keys.some((key) => budgetMatchesKey(budget, key)),
      reachableProjectIds,
    });
  }
  return out;
}
