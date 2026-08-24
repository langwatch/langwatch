/**
 * The legacy api-key authorization surface, kept alive as the ADR-110 fork
 * seam for the gateway and virtual-key paths.
 *
 * Every export here is `@deprecated`. They still RUN — each one asks the
 * engine for a migrated organization and walks the legacy binding tables for
 * one that is not — so this is the code the contract PR deletes, not dead
 * code. New callers decide through `getApp().permissions` /
 * `AuthzService.checkByIds` with an `apiKey` principal, which applies the same
 * ADR-092 §9 owner ceiling (`effective(key) = grants(key) ∩ grants(owner)`)
 * without depending on this fork surviving.
 */
import { createLogger } from "@langwatch/observability";
import {
  OrganizationUserRole,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import {
  bindingScopeCanGrant,
  EXTERNAL_MEMBER_PERMISSIONS,
  hasPermissionWithHierarchy,
  organizationRoleHasPermission,
  type Permission,
  teamRoleHasPermission,
} from "../api/rbac";
import { authzChecksFor } from "../app-layer/authz/checks";
import { organizationOnAuthzEngine } from "../app-layer/authz/engine-gate";
import { CUSTOM_ROLE_KIND } from "../role/role-kind";
import {
  MalformedCustomRolePermissionsError,
  parseCustomRolePermissions,
} from "./custom-role-permissions";

const logger = createLogger("langwatch:rbac:role-binding-resolver");
// ============================================================================
// Types
// ============================================================================

/**
 * @deprecated Use `AuthzScopeRef` from `@langwatch/authz` instead — the
 * engine's scope reference, which the resolvers here convert to anyway.
 */
export type ScopeRef =
  | { type: "org"; id: string }
  | { type: "team"; id: string }
  | { type: "project"; id: string; teamId: string };

/**
 * A principal is the entity whose permissions are being checked.
 * - "user": a human user (supports group memberships)
 * - "apiKey": an API key (no groups)
 */
/**
 * @deprecated Use `AuthzPrincipalRef` from `@langwatch/authz` instead.
 */
export type Principal =
  | { type: "user"; id: string }
  | { type: "apiKey"; id: string };

type ResolvedBinding = {
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
};

// ============================================================================
// Scope resolution helpers
// ============================================================================

/**
 * Returns the ordered list of scopes from most-specific to least-specific
 * for a given target scope. The resolver walks this list and picks the first
 * matching binding.
 */
function ancestorScopes(
  scope: ScopeRef,
): Array<{ type: RoleBindingScopeType; id: string }> {
  switch (scope.type) {
    case "project":
      return [
        { type: RoleBindingScopeType.PROJECT, id: scope.id },
        { type: RoleBindingScopeType.TEAM, id: scope.teamId },
        // org-level is checked separately via resolveHighestRole across all bindings
      ];
    case "team":
      return [{ type: RoleBindingScopeType.TEAM, id: scope.id }];
    case "org":
      return [{ type: RoleBindingScopeType.ORGANIZATION, id: scope.id }];
  }
}

// ============================================================================
// Core resolver
// ============================================================================

/**
 * Collects all RoleBindings for a principal that are relevant to the given scope
 * (i.e. at any ancestor scope: project → team → org).
 *
 * For user principals: direct bindings + group-memberships bindings.
 * For API key principals: queries by apiKeyId only; no group expansion.
 *
 * @internal — use checkRoleBindingPermission for access-control decisions.
 */
async function collectBindingsForScope({
  prisma,
  principal,
  organizationId,
  scope,
}: {
  prisma: PrismaClient;
  principal: Principal;
  organizationId: string;
  scope: ScopeRef;
}): Promise<ResolvedBinding[]> {
  if (principal.type === "apiKey") {
    return collectBindingsForApiKey({
      prisma,
      apiKeyId: principal.id,
      organizationId,
      scope,
    });
  }

  return collectBindingsForUser({
    prisma,
    userId: principal.id,
    organizationId,
    scope,
  });
}

async function collectBindingsForUser({
  prisma,
  userId,
  organizationId,
  scope,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
  scope: ScopeRef;
}): Promise<ResolvedBinding[]> {
  const [directBindings, groupBindings] = await Promise.all([
    prisma.roleBinding.findMany({
      // Gate the direct binding on current organization membership so a stale
      // cross-org binding does not confer access — this is the API-key ceiling
      // path (resolveApiKeyPermission checks the owning user's bindings here),
      // and it must fail closed on membership just like the tRPC resolver.
      where: {
        organizationId,
        userId,
        user: {
          orgMemberships: { some: { organizationId, disabledAt: null } },
        },
      },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    }),
    prisma.roleBinding.findMany({
      // Group-derived bindings carry the same current-membership gate as the
      // direct bindings above. A GroupMembership row outlives removal from the
      // organization, so without this an offboarded user keeps whatever their
      // groups granted.
      where: {
        organizationId,
        group: {
          members: {
            some: {
              userId,
              user: {
                orgMemberships: { some: { organizationId, disabledAt: null } },
              },
            },
          },
        },
      },
      select: {
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    }),
  ]);

  const allOrgBindings = [...directBindings, ...groupBindings];

  const ancestorScopeList = ancestorScopes(scope);
  if (scope.type !== "org") {
    ancestorScopeList.push({
      type: RoleBindingScopeType.ORGANIZATION,
      id: organizationId,
    });
  }

  return allOrgBindings
    .filter((b) =>
      ancestorScopeList.some(
        (s) => s.type === b.scopeType && s.id === b.scopeId,
      ),
    )
    .map((b) => ({
      role: b.role,
      customRoleId: b.customRoleId,
      scopeType: b.scopeType,
    }));
}

async function collectBindingsForApiKey({
  prisma,
  apiKeyId,
  organizationId,
  scope,
}: {
  prisma: PrismaClient;
  apiKeyId: string;
  organizationId: string;
  scope: ScopeRef;
}): Promise<ResolvedBinding[]> {
  const bindings = await prisma.roleBinding.findMany({
    where: { organizationId, apiKeyId },
    select: { role: true, customRoleId: true, scopeType: true, scopeId: true },
  });

  if (bindings.length === 0) return [];

  const ancestorScopeList = ancestorScopes(scope);
  if (scope.type !== "org") {
    ancestorScopeList.push({
      type: RoleBindingScopeType.ORGANIZATION,
      id: organizationId,
    });
  }

  return bindings
    .filter((b) =>
      ancestorScopeList.some(
        (s) => s.type === b.scopeType && s.id === b.scopeId,
      ),
    )
    .map((b) => ({
      role: b.role,
      customRoleId: b.customRoleId,
      scopeType: b.scopeType,
    }));
}

// ============================================================================
// Permission check helper
// ============================================================================

/**
 * The `customRole` predicate that keeps an API key's private permission role
 * with the key it was minted for.
 *
 * A user or a group may never carry one at all. An API key may carry one, but
 * only its own: a binding from key A to key B's system role would otherwise
 * hand B's permissions to A, since the resolver reads whatever role the
 * binding names. "Its own" is the same exclusivity
 * `RoleRepository.isExclusiveToApiKey` uses when deciding a system role is
 * safe to rewrite: every binding on the role belongs to this key, and no
 * legacy assignment holds it.
 */
function systemRoleGuard(principal: Principal) {
  if (principal.type !== "apiKey") {
    return { kind: { not: CUSTOM_ROLE_KIND.SYSTEM_API_KEY } };
  }
  return {
    OR: [
      { kind: { not: CUSTOM_ROLE_KIND.SYSTEM_API_KEY } },
      {
        roleBindings: { every: { apiKeyId: principal.id } },
        assignedUsers: { none: {} },
      },
    ],
  };
}

/**
 * Checks whether a principal has a specific permission at a given scope.
 *
 * All matching bindings across ancestor scopes are evaluated and their
 * permission sets are unioned — the principal is permitted if ANY binding grants
 * the requested permission.
 *
 * Accepts either a userId string (backwards-compatible) or a Principal object.
 *
 * @deprecated Not for new callers. The ADR-110 fork seam for the api-key
 * paths: the engine answers for a migrated organization, the legacy union
 * for one that is not, and this goes away with the legacy half. New code
 * decides through `getApp().permissions` / `AuthzService.checkByIds` with
 * an `apiKey` principal, which applies the same ADR-092 §9 owner ceiling
 * without depending on the fork surviving.
 */
export async function checkRoleBindingPermission({
  prisma,
  userId,
  principal,
  organizationId,
  scope,
  permission,
}: {
  prisma: PrismaClient;
  userId?: string;
  principal?: Principal;
  organizationId: string;
  scope: ScopeRef;
  permission: Permission;
  /**
   * Set by callers that ask this question once per permission in a loop (the
   * API-key mint ceiling): one shadow comparison per permission is ~23
   * detached collects for a single mint, and the mint path's engine coverage
   * already comes from `enforceApiKeyCeiling`, which runs the same check
   * per REQUEST for the key's whole life.
   */
}): Promise<boolean> {
  const resolvedPrincipal: Principal = principal ?? {
    type: "user",
    id: userId!,
  };
  const legacyPermitted = () =>
    checkRoleBindingPermissionInner({
      prisma,
      principal: resolvedPrincipal,
      organizationId,
      scope,
      permission,
    });

  // The NAMED principal only, with no owner ceiling: this function reports
  // one principal's own grants and nothing else, which is its contract and
  // its suite's subject.
  if (await organizationOnAuthzEngine({ prisma, organizationId })) {
    const decision = await authzChecksFor(prisma).checkByIds({
      principal: resolvedPrincipal,
      permission,
      ceiling: false,
      ...scopeRefToIds(scope, organizationId),
    });
    return decision.allowed;
  }

  return legacyPermitted();
}

function scopeRefToIds(
  scope: ScopeRef,
  organizationId: string,
): { projectId?: string; teamId?: string; organizationId?: string } {
  switch (scope.type) {
    case "project":
      return { projectId: scope.id };
    case "team":
      return { teamId: scope.id };
    case "org":
      return { organizationId };
  }
}

async function checkRoleBindingPermissionInner({
  prisma,
  principal,
  organizationId,
  scope,
  permission,
}: {
  prisma: PrismaClient;
  principal: Principal;
  organizationId: string;
  scope: ScopeRef;
  permission: Permission;
}): Promise<boolean> {
  const bindings = await collectBindingsForScope({
    prisma,
    principal,
    organizationId,
    scope,
  });

  for (const binding of bindings) {
    // A team/project binding can never grant an org-exclusive permission,
    // even via a custom role that lists it (ADR-021). Stays in sync with
    // checkPermissionFromBindings() in rbac.ts.
    if (!bindingScopeCanGrant(binding.scopeType, permission)) continue;

    // Custom role: look up its permissions. Defense in depth on two axes:
    // the lookup is scoped to the organization being checked, so a poisoned
    // binding pointing at another organization's role grants nothing of that
    // role even if a write path let it through; and an API key's private
    // permission role (kind system_api_key) backs only that key's own
    // bindings, never a user's, a group's, or another key's. Either mismatch
    // resolves exactly like a missing role: the built-in CUSTOM baseline
    // below, which cannot carry the foreign role's permissions.
    if (binding.role === TeamUserRole.CUSTOM && binding.customRoleId) {
      const customRole = await prisma.customRole.findFirst({
        where: {
          id: binding.customRoleId,
          organizationId,
          ...systemRoleGuard(principal),
        },
        select: { permissions: true },
      });
      // Use the shared parser so shape validation is consistent with the
      // API-key-create ceiling path. On malformed data we fail safe here (the
      // caller is a permission check — deny, log, move on) rather than
      // bubbling the error up, because unrelated principals should not be
      // blocked by one corrupted custom role.
      let perms: string[] = [];
      if (customRole) {
        try {
          perms = parseCustomRolePermissions({
            customRoleId: binding.customRoleId,
            permissions: customRole.permissions,
          });
        } catch (err) {
          if (err instanceof MalformedCustomRolePermissionsError) {
            logger.warn(
              { err, customRoleId: binding.customRoleId },
              "custom role has malformed permissions; treating as no-grant",
            );
          } else {
            throw err;
          }
        }
      }
      if (perms.length > 0) {
        if (hasPermissionWithHierarchy(perms, permission)) {
          return true;
        }
        // Non-empty custom role is authoritative — skip VIEWER baseline.
        // See also resolveBindingPermission() in rbac.ts which must stay
        // in sync with this logic.
        continue;
      }
      // Empty/missing/malformed custom role — fall through to the built-in
      // CUSTOM permission set below (VIEWER-equivalent baseline). This
      // preserves backward compatibility for legacy CUSTOM bindings that
      // were created before fine-grained permissions existed.
    }

    // Org-scoped bindings: ADMIN grants everything; MEMBER grants org-level permissions only
    if (
      binding.scopeType === RoleBindingScopeType.ORGANIZATION &&
      binding.role !== TeamUserRole.CUSTOM
    ) {
      if (binding.role === TeamUserRole.ADMIN) return true;
      if (
        organizationRoleHasPermission(OrganizationUserRole.MEMBER, permission)
      )
        return true;
      continue;
    }

    if (teamRoleHasPermission(binding.role, permission)) {
      return true;
    }
  }

  return false;
}

/**
 * A user's legacy `TeamUser` ceiling, resolved once and then asked about as
 * many permissions as the caller needs.
 *
 * `checkRoleBindingPermission` reports RoleBindings and nothing else, on
 * purpose — its own suite pins that. The tRPC path layers a legacy fallback on
 * top of it for users who predate the RoleBinding migration, and every OTHER
 * consumer has to layer the same thing or it disagrees with tRPC about who can
 * do what. That disagreement is exactly how a user came to pass every
 * authorization check and then be refused those same permissions when minting
 * a key: Langy mints a per-turn key mirroring the caller's permissions, so on
 * an affected workspace every turn died with an opaque error.
 *
 * Two-phase on purpose. The mint path checks ~23 permissions inside a
 * five-second interactive transaction, and a per-permission query fan-out has
 * already starved the connection pool there once. The database work happens
 * here, once; `grants` is pure.
 *
 * It is one function rather than a role returned to each caller because the
 * three rules below have to be applied to that role EVERY time, and the
 * version that returned a bare role had already lost two of them at one call
 * site apiece.
 */
/**
 * @deprecated The legacy ceiling's answer shape — see `resolveLegacyCeiling`.
 */
export type LegacyCeiling = {
  /** Whether the legacy role confers this permission, all floors applied. */
  grants: (permission: Permission) => boolean;
};

const LEGACY_CEILING_DENIES_ALL: LegacyCeiling = { grants: () => false };

/**
 * @deprecated The legacy half of the api-key ceiling, deprecated with the fork
 * that calls it — see `resolveApiKeyPermission`. The engine expresses the same
 * ceiling as `decideWithCeiling`.
 */
export async function resolveLegacyCeiling({
  prisma,
  userId,
  organizationId,
  scope,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
  scope: ScopeRef;
}): Promise<LegacyCeiling> {
  // An org-wide grant is not something a team role should be able to reach.
  if (scope.type === "org") return LEGACY_CEILING_DENIES_ALL;
  const teamId = scope.type === "project" ? scope.teamId : scope.id;

  // Current membership (fail closed on it, exactly as the binding queries do)
  // and the group ids, in one round trip. The org role is needed because
  // EXTERNAL members are capped before any team role is consulted.
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      orgMemberships: { some: { organizationId, disabledAt: null } },
    },
    select: {
      orgMemberships: {
        where: { organizationId, disabledAt: null },
        select: { role: true },
      },
      groupMemberships: {
        where: { group: { organizationId } },
        select: { groupId: true },
      },
    },
  });
  const organizationRole = user?.orgMemberships[0]?.role;
  if (!user || organizationRole === undefined) return LEGACY_CEILING_DENIES_ALL;

  const groupIds = user.groupMemberships.map((m) => m.groupId);

  // The fallback applies only to a user with NO bindings AT THE SCOPES IN
  // PLAY — the same predicate `loadScopeResolution` uses, group bindings
  // included. Two narrower versions of this test were both wrong in their own
  // direction: counting only DIRECT bindings let a binding held through a
  // group sit unnoticed beside a stale legacy row, so the legacy role stacked
  // on top of a real one; counting ORG-WIDE let a binding on an unrelated team
  // suppress the fallback here while tRPC still applied it, which is the very
  // scope violation this fallback exists to cure.
  const bindingCount = await prisma.roleBinding.count({
    where: {
      organizationId,
      scopeId: {
        in: [organizationId, ...ancestorScopes(scope).map((s) => s.id)],
      },
      OR: [
        { userId },
        ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : []),
      ],
    },
  });
  if (bindingCount > 0) return LEGACY_CEILING_DENIES_ALL;

  const teamUser = await prisma.teamUser.findFirst({
    // The team must belong to the organization being asked about, not just
    // exist. The membership gate above proves the USER is in this org; without
    // this, a legacy row on a team in a DIFFERENT org would still resolve a
    // grant here. Unreachable today — both callers derive `scope` from a
    // validated project or team — but `loadScopeResolution` carries the same
    // predicate, and this function's docstring claims parity with it.
    where: { userId, teamId, team: { organizationId } },
    select: { role: true },
  });

  // A CUSTOM legacy role carries its permissions on an assigned role rather
  // than the enum, which `teamRoleHasPermission` cannot answer — leave those
  // to the binding path rather than guessing at a grant.
  if (!teamUser || teamUser.role === TeamUserRole.CUSTOM) {
    return LEGACY_CEILING_DENIES_ALL;
  }
  const legacyRole = teamUser.role;

  return {
    grants: (permission) =>
      // ADR-021: a team-scoped grant can never confer an org-exclusive
      // permission. `rbac.ts` applies this to legacy roles via `bindingGrants`,
      // which opens with the same check.
      bindingScopeCanGrant(RoleBindingScopeType.TEAM, permission) &&
      // EXTERNAL members are capped by their ORG role before the team role is
      // read at all (`bindingGrants`, same order). A ceiling that skipped this
      // accepted permissions the tRPC path refuses.
      (organizationRole === OrganizationUserRole.EXTERNAL
        ? hasPermissionWithHierarchy(EXTERNAL_MEMBER_PERMISSIONS, permission)
        : teamRoleHasPermission(legacyRole, permission)),
  };
}

/**
 * Resolution-time ceiling enforcement for API keys.
 *
 * effective_permissions = ApiKey.roleBindings(scope) ∩ user.roleBindings(scope)
 *
 * Returns true only if BOTH the API key's own bindings AND the owning user's
 * current bindings grant the requested permission. If the user's role has been
 * downgraded, the API key auto-degrades immediately.
 *
 * @deprecated Not for new callers. The ADR-110 fork seam for the api-key
 * paths: the engine answers for a migrated organization, the legacy union
 * for one that is not, and this goes away with the legacy half. New code
 * decides through `getApp().permissions` / `AuthzService.checkByIds` with
 * an `apiKey` principal, which applies the same ADR-092 §9 owner ceiling
 * without depending on the fork surviving.
 */
export async function resolveApiKeyPermission({
  prisma,
  apiKeyId,
  userId,
  organizationId,
  scope,
  permission,
}: {
  prisma: PrismaClient;
  apiKeyId: string;
  userId: string | null;
  organizationId: string;
  scope: ScopeRef;
  permission: Permission;
  /** See checkRoleBindingPermission - the per-permission mint loops opt out. */
}): Promise<boolean> {
  /**
   * Steps 1-4 of the legacy ceiling — the answering path below when the
   * organization is still on legacy. (It was also the fork's reverse-shadow
   * thunk before the shadow comparison was removed; a migrated organization is
   * now answered by the engine outright.)
   */
  const legacyPermitted = async (): Promise<boolean> => {
    // 1. Check API key's own bindings (inner variant: the composite check
    // below covers this path, so the per-leg wrapper is skipped)
    const apiKeyAllowed = await checkRoleBindingPermissionInner({
      prisma,
      principal: { type: "apiKey", id: apiKeyId },
      organizationId,
      scope,
      permission,
    });

    if (!apiKeyAllowed) return false;
    // 2. Service keys (no userId) have no user ceiling — binding check is
    //    sufficient
    if (!userId) return true;

    // 3. Check owning user's current bindings (ceiling)
    const userAllowed = await checkRoleBindingPermissionInner({
      prisma,
      principal: { type: "user", id: userId },
      organizationId,
      scope,
      permission,
    });
    if (userAllowed) return true;

    // 4. Fall back to legacy membership, the same way the mint-side ceiling
    //    and the tRPC path do.
    //
    //    Without this the mint-side fix was no fix at all: the population it
    //    targets is DEFINED by holding zero RoleBindings, so step 3 returns
    //    false for every permission and the key it just allowed to be minted
    //    is a dead credential. Every REST route funnels through
    //    `enforceApiKeyCeiling`, so the failure only moved — from a refusal
    //    at mint time to every tool call 403ing after the turn had already
    //    started streaming, which is the worse of the two.
    //
    //    Safe by construction: this can only restore access the same legacy
    //    role already grants through tRPC, which is what the key's
    //    permission set was measured from in the first place.
    const legacy = await resolveLegacyCeiling({
      prisma,
      userId,
      organizationId,
      scope,
    });
    return legacy.grants(permission);
  };

  // The engine states the same ceiling as algebra — effective(key) =
  // grants(key) ∩ grants(owner) — rather than as the four steps above. The
  // key's owner is resolved by the collector, so it is not passed here.
  if (await organizationOnAuthzEngine({ prisma, organizationId })) {
    const decision = await authzChecksFor(prisma).checkByIds({
      principal: { type: "apiKey", id: apiKeyId },
      permission,
      ...scopeRefToIds(scope, organizationId),
    });
    return decision.allowed;
  }

  return legacyPermitted();
}
