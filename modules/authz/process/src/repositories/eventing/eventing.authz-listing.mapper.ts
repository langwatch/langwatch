// The grant-head rows an access listing reads, translated to the legacy vocabulary one way.
import type {
  AuthzAccessApiKey,
  AuthzAccessBinding,
  AuthzAccessGroup,
  AuthzAccessUser,
  AuthzBindingForSynthesis,
  AuthzCustomRole,
  AuthzTeamMemberBinding,
  GrantScopeTier,
  TeamUserRole,
} from "@langwatch/authz-contract";
import { type Instant, toDate } from "@langwatch/time";

import { isBindingRoleKey } from "./eventing.authz-read.mapper.ts";

export const USER_CREATED_ROLE_KIND = "custom" as const;

/** The three scope tiers a listed binding can carry - RESOURCE rows are the
 *  share tier and PLATFORM rows are dormant facts; neither is a binding the
 *  Access surface lists. */
export const BINDING_SCOPE_TYPES = ["ORGANIZATION", "TEAM", "PROJECT"] as const;

/** The three principal kinds the legacy tables could express. Collective
 *  principals (team / organization / project / anyone) are future-head-only
 *  and never listed. */
export const BINDING_PRINCIPAL_TYPES = ["USER", "GROUP", "API_KEY"] as const;

/** The built-in role keys; with `custom:<id>` the shapes the legacy vocabulary can carry. */
export const LISTABLE_BUILT_IN_ROLE_KEYS = ["admin", "member", "viewer"] as const;

export type GrantListRow = {
  id: string;
  organizationId: string;
  principalType: string;
  principalId: string | null;
  roleKey: string | null;
  legacyRole: string | null;
  scopeType: string;
  scopeId: string;
  /** The stored end moment as the store hands it back; listed past its own date too. */
  expiresAt: unknown;
  occurredAt: Instant;
  updatedAt: Instant;
};

export type ListableGrant = {
  row: GrantListRow;
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: GrantScopeTier;
};

export type RoleHeadListRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  permissions: unknown;
  kind: string;
  occurredAt: Instant;
  updatedAt: Instant;
};

export type DecorationIds = {
  user: Set<string>;
  group: Set<string>;
  apiKey: Set<string>;
  role: Set<string>;
};

export type Decoration = {
  userById: Map<string, AuthzAccessUser>;
  groupById: Map<string, AuthzAccessGroup>;
  apiKeyById: Map<string, AuthzAccessApiKey>;
  roleById: Map<string, AuthzCustomRole>;
};

/** `LISTABLE_ROLE_KEY_WHERE` as a predicate: a built-in key, or one starting `custom:`. */
export function isListableRoleKey(roleKey: string | null): boolean {
  if (roleKey === null) return false;
  return (
    (LISTABLE_BUILT_IN_ROLE_KEYS as readonly string[]).includes(roleKey) ||
    roleKey.startsWith("custom:")
  );
}

function isBindingScope(scopeType: string): scopeType is GrantScopeTier {
  return (BINDING_SCOPE_TYPES as readonly string[]).includes(scopeType);
}

function isBindingPrincipal(principalType: string): boolean {
  return (BINDING_PRINCIPAL_TYPES as readonly string[]).includes(principalType);
}

function isTeamUserRole(value: string | null): value is TeamUserRole {
  return value === "ADMIN" || value === "MEMBER" || value === "VIEWER" || value === "CUSTOM";
}

const BUILT_IN_TEAM_ROLE = { admin: "ADMIN", member: "MEMBER", viewer: "VIEWER" } as const;

export function listableGrants(rows: readonly GrantListRow[]): ListableGrant[] {
  const listable: ListableGrant[] = [];
  for (const row of rows) {
    if (!isBindingScope(row.scopeType)) continue;
    if (!isBindingPrincipal(row.principalType)) continue;
    // roleKey → the compat pair the fold writes onto the legacy head.
    const { roleKey, legacyRole } = row;
    if (!isBindingRoleKey(roleKey)) continue;
    if (roleKey === "admin" || roleKey === "member" || roleKey === "viewer") {
      listable.push({
        row,
        role: BUILT_IN_TEAM_ROLE[roleKey],
        customRoleId: null,
        scopeType: row.scopeType,
      });
      continue;
    }
    listable.push({
      row,
      role: isTeamUserRole(legacyRole) ? legacyRole : "CUSTOM",
      customRoleId: roleKey.slice("custom:".length),
      scopeType: row.scopeType,
    });
  }
  return listable;
}

export function collectDecorationIds(grants: readonly ListableGrant[]): DecorationIds {
  const ids: DecorationIds = {
    user: new Set(),
    group: new Set(),
    apiKey: new Set(),
    role: new Set(),
  };
  const byPrincipalType: Partial<Record<string, Set<string>>> = {
    USER: ids.user,
    GROUP: ids.group,
    API_KEY: ids.apiKey,
  };
  for (const grant of grants) {
    if (grant.customRoleId) ids.role.add(grant.customRoleId);
    if (grant.row.principalId) {
      byPrincipalType[grant.row.principalType]?.add(grant.row.principalId);
    }
  }
  return ids;
}

function principalOf({
  row,
  decoration,
}: {
  row: ListableGrant["row"];
  decoration: Decoration;
}): Pick<AuthzAccessBinding, "user" | "group" | "apiKey"> {
  const { principalId } = row;
  if (!principalId) return { user: null, group: null, apiKey: null };
  return {
    user: row.principalType === "USER" ? (decoration.userById.get(principalId) ?? null) : null,
    group: row.principalType === "GROUP" ? (decoration.groupById.get(principalId) ?? null) : null,
    apiKey:
      row.principalType === "API_KEY" ? (decoration.apiKeyById.get(principalId) ?? null) : null,
  };
}

/** The principal and role decoration for the listed rows. With
 *  `shouldDropUndecoratedPrincipals`, a row whose principal no longer resolves
 *  in the organization is dropped; without it, it decorates to null and stays. */
export function decoratedBindings({
  grants,
  decoration,
  shouldDropUndecoratedPrincipals,
}: {
  grants: readonly ListableGrant[];
  decoration: Decoration;
  shouldDropUndecoratedPrincipals: boolean;
}): AuthzAccessBinding[] {
  const listed: AuthzAccessBinding[] = [];
  for (const grant of grants) {
    const { row } = grant;
    const { user, group, apiKey } = principalOf({ row, decoration });
    if (shouldDropUndecoratedPrincipals && !user && !group && !apiKey) continue;
    const customRole = grant.customRoleId
      ? (decoration.roleById.get(grant.customRoleId) ?? null)
      : null;
    listed.push({
      id: row.id,
      organizationId: row.organizationId,
      userId: row.principalType === "USER" ? row.principalId : null,
      groupId: row.principalType === "GROUP" ? row.principalId : null,
      apiKeyId: row.principalType === "API_KEY" ? row.principalId : null,
      role: grant.role,
      customRoleId: grant.customRoleId,
      scopeType: grant.scopeType,
      scopeId: row.scopeId,
      createdAt: toDate(row.occurredAt),
      expiresAt: row.expiresAt instanceof Date ? row.expiresAt : null,
      user,
      group,
      apiKey,
      customRole,
    });
  }
  return listed;
}

/** A `Role` head row in the `CustomRole` column shape; `createdAt` is the fact's business time. */
export function toCustomRoleShape(role: RoleHeadListRow): AuthzCustomRole {
  return {
    id: role.id,
    organizationId: role.organizationId,
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    kind: role.kind,
    createdAt: toDate(role.occurredAt),
    updatedAt: toDate(role.updatedAt),
  };
}

/** The member list's shape mirrors a legacy `TeamUser` join, whole user and role. */
export function teamMemberBindingsFrom({
  teamIds,
  grants,
  users,
  roles,
}: {
  teamIds: readonly string[];
  grants: readonly ListableGrant[];
  users: readonly AuthzAccessUser[];
  roles: readonly AuthzCustomRole[];
}): Map<string, AuthzTeamMemberBinding[]> {
  const byTeam = new Map<string, AuthzTeamMemberBinding[]>(teamIds.map((teamId) => [teamId, []]));
  const userById = new Map(users.map((user) => [user.id, user]));
  const roleById = new Map(roles.map((role) => [role.id, role]));
  for (const grant of grants) {
    const user = grant.row.principalId ? userById.get(grant.row.principalId) : undefined;
    if (!user) continue;
    byTeam.get(grant.row.scopeId)?.push({
      userId: user.id,
      role: grant.role,
      customRoleId: grant.customRoleId,
      createdAt: toDate(grant.row.occurredAt),
      updatedAt: toDate(grant.row.updatedAt),
      user,
      customRole: grant.customRoleId ? (roleById.get(grant.customRoleId) ?? null) : null,
    });
  }
  return byTeam;
}

/** The user ids and role ids a team member listing decorates. */
export function teamMemberDecorationIds(grants: readonly ListableGrant[]): {
  userIds: string[];
  roleIds: string[];
} {
  return {
    userIds: [...new Set(grants.flatMap(({ row }) => (row.principalId ? [row.principalId] : [])))],
    roleIds: [
      ...new Set(grants.flatMap(({ customRoleId }) => (customRoleId ? [customRoleId] : []))),
    ],
  };
}

/** A group grant counts only for a group the user is in, in the grant's own organization. A
 *  Developer (ADR-171) gains nothing through an organization-scoped or group binding. */
export function synthesisGrants({
  rows,
  groupIdsByOrg,
  developerOrgIds,
}: {
  rows: readonly GrantListRow[];
  groupIdsByOrg: Map<string, Set<string>>;
  developerOrgIds: Set<string>;
}): ListableGrant[] {
  return listableGrants(rows)
    .filter(
      ({ row }) =>
        row.principalType !== "GROUP" ||
        (row.principalId != null &&
          groupIdsByOrg.get(row.organizationId)?.has(row.principalId) === true),
    )
    .filter(
      ({ row, scopeType }) =>
        !developerOrgIds.has(row.organizationId) ||
        (row.principalType !== "GROUP" && scopeType !== "ORGANIZATION"),
    );
}

/** The custom role ids each organization's synthesized grants name. */
export function roleIdsByOrganization(grants: readonly ListableGrant[]): Map<string, Set<string>> {
  const roleIdsByOrg = new Map<string, Set<string>>();
  for (const { row, customRoleId } of grants) {
    if (!customRoleId) continue;
    if (!roleIdsByOrg.has(row.organizationId)) roleIdsByOrg.set(row.organizationId, new Set());
    roleIdsByOrg.get(row.organizationId)?.add(customRoleId);
  }
  return roleIdsByOrg;
}

export function bindingsForSynthesisFrom({
  grants,
  rolesByOrg,
}: {
  grants: readonly ListableGrant[];
  rolesByOrg: Map<string, Map<string, AuthzCustomRole>>;
}): AuthzBindingForSynthesis[] {
  return grants.map(({ row, role, customRoleId, scopeType }) => {
    const customRole = customRoleId
      ? (rolesByOrg.get(row.organizationId)?.get(customRoleId) ?? null)
      : null;
    return {
      organizationId: row.organizationId,
      scopeType,
      scopeId: row.scopeId,
      role,
      customRoleId,
      customRole: customRole
        ? {
            id: customRole.id,
            name: customRole.name,
            description: customRole.description,
            permissions: customRole.permissions,
            organizationId: customRole.organizationId,
            createdAt: customRole.createdAt,
            updatedAt: customRole.updatedAt,
          }
        : null,
    };
  });
}

/** Business time, then id: batch-imported facts share an `occurredAt`. */
export function byOccurredAtThenId(
  a: { occurredAt: Instant; id: string },
  b: { occurredAt: Instant; id: string },
): number {
  const byTime = a.occurredAt.epochMilliseconds - b.occurredAt.epochMilliseconds;
  if (byTime !== 0) return byTime;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
