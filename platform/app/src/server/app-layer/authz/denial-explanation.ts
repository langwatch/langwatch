/**
 * ADR-092 §6 — "Explainability is not a feature bolted on later. It is the
 * engine's decision object, rendered." This module is where that rendering
 * happens for the person who was just refused.
 *
 * One walk, two audiences, two shapes:
 *
 *   OPERATOR   `AuthzService.explainDecision`'s lines, verbatim, on a log
 *              line. They name scope ids, group ids and the bindings the
 *              chain filtered out — exactly what a support question needs,
 *              and exactly what a customer must never be handed.
 *
 *   CUSTOMER   {@link DenialExplanation}: role LABELS and nothing else. No
 *              ids, no engine prose, no finished sentence. The words the
 *              customer reads are written in the client presentation
 *              registry under `permission_denied`; this side ships data.
 *
 * Everything here is best effort. A denial is a denial whether or not it can
 * be explained, so every failure path returns `null` and the generic copy
 * stands on its own. The whole attempt runs under a deadline too: a slow
 * collect must not turn a refusal into a hang.
 */
import {
  type AuthzPermission,
  type AuthzScopeRef,
  type BuiltinRoleKey,
  builtinRoleGrants,
  type CollectedGrants,
  type DeclaredScopeId,
  scopeChain,
  type TeamUserRole,
} from "@langwatch/authz";
import { createLogger } from "@langwatch/observability";

import { authz, authzCollector } from "./runtime";

const logger = createLogger("langwatch:authz");

/**
 * The customer-safe half of the engine's "why".
 *
 * `heldRoles` is what the caller already holds on this scope's chain, so the
 * copy can say which of their roles fell short instead of implying they hold
 * none. `wouldGrantRoles` is the answer to the question they actually have:
 * what do I ask for.
 */
export type DenialExplanation = {
  heldRoles: string[];
  wouldGrantRoles: string[];
};

/**
 * Ceiling on the whole explanation attempt. Denials are rare, so paying for
 * a second collect is fine; waiting on a wedged one is not.
 */
const EXPLAIN_BUDGET_MS = 250;

/**
 * A custom role's own name is not in the collected snapshot (only its id and
 * its permission list are), and an id is not something to show a customer —
 * so every custom role renders under the product's own word for it.
 */
const CUSTOM_ROLE_LABEL = "Custom";

const TEAM_ROLE_LABELS: Record<TeamUserRole, string> = {
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
  CUSTOM: CUSTOM_ROLE_LABEL,
};

/** The order the Access surface lists roles in, so the same two roles never
 *  render two different ways. */
const ROLE_LABEL_ORDER: readonly string[] = [
  "Admin",
  "Member",
  "Viewer",
  CUSTOM_ROLE_LABEL,
];

/**
 * The roles a person can be given at each tier.
 *
 * Lite member and demo viewer are deliberately absent: neither is a role an
 * admin grants, so naming one would be an errand nobody can run.
 */
const GRANTABLE_ROLES: Record<
  DeclaredScopeId["tier"],
  ReadonlyArray<{ role: BuiltinRoleKey; label: string }>
> = {
  project: [
    { role: "admin", label: "Admin" },
    { role: "member", label: "Member" },
    { role: "viewer", label: "Viewer" },
  ],
  team: [
    { role: "admin", label: "Admin" },
    { role: "member", label: "Member" },
    { role: "viewer", label: "Viewer" },
  ],
  organization: [
    { role: "org-admin", label: "Organization admin" },
    { role: "org-member", label: "Organization member" },
  ],
};

/**
 * Explains one refusal, or answers `null` when it cannot.
 *
 * Called only for a denial a grant would fix (`no-binding`) and only for a
 * real user: a disabled seat and a lite member each have their own answer,
 * and neither is "ask for a role".
 */
export async function explainDenial({
  userId,
  permission,
  scope,
}: {
  userId: string;
  permission: AuthzPermission;
  scope: DeclaredScopeId;
}): Promise<DenialExplanation | null> {
  try {
    return await withBudget(() =>
      collectExplanation({ userId, permission, scope }),
    );
  } catch (error) {
    // Nothing here is worth failing a request over — the caller already has
    // the denial it came for, and the client copy reads fine without us.
    logger.debug(
      { error, permission, scopeType: scope.tier },
      "could not explain a permission denial",
    );
    return null;
  }
}

async function collectExplanation({
  userId,
  permission,
  scope,
}: {
  userId: string;
  permission: AuthzPermission;
  scope: DeclaredScopeId;
}): Promise<DenialExplanation | null> {
  const scopeRef = await authzCollector.resolveScopeRef({
    projectId: scope.tier === "project" ? scope.id : undefined,
    teamId: scope.tier === "team" ? scope.id : undefined,
    organizationId: scope.tier === "organization" ? scope.id : undefined,
  });
  // An id that resolves to nothing is denied exactly like one the caller may
  // not touch, and saying anything at all here would tell them which it was.
  if (!scopeRef) return null;

  const { decision, grants } = await authz.checkDetailed({
    principal: { type: "user", id: userId },
    permission,
    scope: scopeRef,
  });
  // A grant landing between the check and this call: explaining a denial
  // that no longer holds would read as nonsense.
  if (decision.allowed) return null;

  // The operator's half. Behind its own guard so a logging failure cannot
  // cost the customer their copy.
  try {
    logger.debug(
      {
        permission,
        scopeType: scope.tier,
        walk: await authz.explainDecision({ decision }),
      },
      "permission denied, engine walk",
    );
  } catch (error) {
    logger.debug({ error }, "could not render the engine walk for a denial");
  }

  return {
    heldRoles: heldRoleLabels({ grants, scope: scopeRef }),
    wouldGrantRoles: rolesThatWouldGrant({ permission, tier: scope.tier }),
  };
}

/**
 * The distinct roles the caller holds AT this scope or above it — the same
 * chain filter the engine's own walk applies, so the copy can never claim a
 * binding was considered when it was not.
 */
function heldRoleLabels({
  grants,
  scope,
}: {
  grants: CollectedGrants;
  scope: AuthzScopeRef;
}): string[] {
  const chain = scopeChain(scope);
  const labels = new Set<string>();
  for (const binding of grants.bindings) {
    const onChain = chain.some(
      (link) =>
        link.scopeType === binding.scopeType &&
        link.scopeId === binding.scopeId,
    );
    if (!onChain) continue;
    labels.add(
      binding.customRoleId ? CUSTOM_ROLE_LABEL : TEAM_ROLE_LABELS[binding.role],
    );
  }
  return ROLE_LABEL_ORDER.filter((label) => labels.has(label));
}

/**
 * Which grantable roles carry the permission at the tier it was refused at.
 *
 * Built-in roles only. A custom role that carries it is a real answer, but
 * the collected snapshot holds permission lists only for the roles THIS
 * caller already references, so listing "the custom roles that would work"
 * would be listing the wrong set.
 */
function rolesThatWouldGrant({
  permission,
  tier,
}: {
  permission: AuthzPermission;
  tier: DeclaredScopeId["tier"];
}): string[] {
  return GRANTABLE_ROLES[tier]
    .filter(({ role }) => builtinRoleGrants({ role, permission }))
    .map(({ label }) => label);
}

/** Races `run` against {@link EXPLAIN_BUDGET_MS}; a slow answer is dropped. */
async function withBudget<T>(run: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), EXPLAIN_BUDGET_MS);
  });
  try {
    return await Promise.race([run(), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
