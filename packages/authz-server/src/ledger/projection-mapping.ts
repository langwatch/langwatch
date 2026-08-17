import type { TeamUserRole } from "@langwatch/authz";
import type {
  GrantEventSource,
  GrantFact,
  LedgerPrincipalType,
  LedgerScopeType,
  RoleFact,
} from "./grants-ledger.reducer";

/**
 * Pure row mapping for the grants ledger's Postgres projection: reducer
 * facts ↔ `Grant`/`Role` rows (the future head) and reducer facts → the
 * legacy-shaped `RoleBinding`/`CustomRole` rows (the compat head). The
 * roleKey ↔ (role, customRoleId) translation lives ONLY here (delivery-plan
 * decision 10) — nothing else in the codebase may know both vocabularies.
 *
 * Storage-free on purpose (ADR-070): the row shapes below are the
 * projection's CONTRACT; the app's Prisma repository satisfies them
 * structurally — its generated enums are these same string literals.
 */

/** The Grant table's principal vocabulary (uppercase, the DB's spelling). */
export type GrantPrincipalTypeDb =
  | "USER"
  | "API_KEY"
  | "GROUP"
  | "TEAM"
  | "ORGANIZATION"
  | "PROJECT"
  | "ANYONE";

/** The Grant table's scope vocabulary — same five names as the ledger's. */
export type GrantScopeTypeDb = LedgerScopeType;

const PRINCIPAL_TO_DB: Record<LedgerPrincipalType, GrantPrincipalTypeDb> = {
  user: "USER",
  api_key: "API_KEY",
  group: "GROUP",
  team: "TEAM",
  organization: "ORGANIZATION",
  project: "PROJECT",
  anyone: "ANYONE",
};

const PRINCIPAL_FROM_DB: Record<GrantPrincipalTypeDb, LedgerPrincipalType> = {
  USER: "user",
  API_KEY: "api_key",
  GROUP: "group",
  TEAM: "team",
  ORGANIZATION: "organization",
  PROJECT: "project",
  ANYONE: "anyone",
};

export interface GrantRowShape {
  id: string;
  organizationId: string;
  principalType: GrantPrincipalTypeDb;
  principalId: string | null;
  roleKey: string | null;
  source: string;
  scopeType: GrantScopeTypeDb;
  scopeId: string;
  token: string | null;
  permission: string | null;
  expiresAt: Date | null;
  maxViews: number | null;
  occurredAt: Date;
}

export function grantFactToRow({
  grant,
  organizationId,
}: {
  grant: GrantFact;
  organizationId: string;
}): GrantRowShape {
  return {
    id: grant.grantId,
    organizationId,
    principalType: PRINCIPAL_TO_DB[grant.principal.type],
    principalId: grant.principal.id,
    roleKey: grant.roleKey,
    source: grant.source,
    // The ledger and Prisma scope enums share their five value names.
    scopeType: grant.scope.type,
    scopeId: grant.scope.id,
    token: grant.resource?.token ?? null,
    permission: grant.resource?.permission ?? null,
    expiresAt:
      grant.resource?.expiresAtMs != null
        ? new Date(grant.resource.expiresAtMs)
        : null,
    maxViews: grant.resource?.maxViews ?? null,
    occurredAt: new Date(grant.occurredAtMs),
  };
}

export function grantRowToFact(row: GrantRowShape): GrantFact {
  return {
    grantId: row.id,
    principal: { type: PRINCIPAL_FROM_DB[row.principalType], id: row.principalId },
    roleKey: row.roleKey,
    scope: { type: row.scopeType as LedgerScopeType, id: row.scopeId },
    ...(row.token != null && row.permission != null
      ? {
          resource: {
            token: row.token,
            permission: row.permission,
            ...(row.expiresAt != null
              ? { expiresAtMs: row.expiresAt.getTime() }
              : {}),
            ...(row.maxViews != null ? { maxViews: row.maxViews } : {}),
          },
        }
      : {}),
    source: row.source as GrantEventSource,
    occurredAtMs: row.occurredAt.getTime(),
  };
}

export interface RoleRowShape {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  permissions: string[];
  kind: string;
  occurredAt: Date;
}

export function roleFactToRow({
  role,
  organizationId,
}: {
  role: RoleFact;
  organizationId: string;
}): RoleRowShape {
  return {
    id: role.roleId,
    organizationId,
    name: role.name,
    description: role.description ?? null,
    permissions: role.permissions,
    kind: role.kind,
    occurredAt: new Date(role.occurredAtMs),
  };
}

export function roleRowToFact(row: RoleRowShape): RoleFact {
  return {
    roleId: row.id,
    name: row.name,
    ...(row.description != null ? { description: row.description } : {}),
    permissions: row.permissions,
    kind: row.kind as RoleFact["kind"],
    occurredAtMs: row.occurredAt.getTime(),
  };
}

export interface CompatBindingRowShape {
  /** The grantId itself — deterministic, so compat upserts are idempotent
   *  and compat deletes can never touch a legacy-authored row. */
  id: string;
  organizationId: string;
  userId: string | null;
  groupId: string | null;
  apiKeyId: string | null;
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
}

/**
 * The compat head projects only what the legacy tables can express:
 * scope ∈ ORGANIZATION|TEAM|PROJECT, principal ∈ user|group|api_key, and a
 * roleKey the `TeamUserRole` enum can carry. RESOURCE and PLATFORM rows,
 * collective principals (team/organization/project/anyone), and
 * `lite-member` (an org-level concept `RoleBinding` never represented) are
 * future-head-only; the legacy resolver never answered for them, so their
 * absence from the compat view changes nothing it reads.
 *
 * roleKey → (role, customRoleId), the inverse of
 * `roleKeyForTeamRole` in @langwatch/authz (roles.ts): admin→ADMIN,
 * member→MEMBER, viewer→VIEWER, custom:<id>→(CUSTOM, id).
 */
export function grantFactToCompatBinding({
  grant,
  organizationId,
}: {
  grant: GrantFact;
  organizationId: string;
}): CompatBindingRowShape | null {
  const { scope, principal, roleKey } = grant;
  if (
    scope.type !== "ORGANIZATION" &&
    scope.type !== "TEAM" &&
    scope.type !== "PROJECT"
  ) {
    return null;
  }
  if (
    principal.type !== "user" &&
    principal.type !== "group" &&
    principal.type !== "api_key"
  ) {
    return null;
  }
  if (roleKey == null || principal.id == null) return null;

  let role: TeamUserRole;
  let customRoleId: string | null = null;
  if (roleKey === "admin") role = "ADMIN";
  else if (roleKey === "member") role = "MEMBER";
  else if (roleKey === "viewer") role = "VIEWER";
  else if (roleKey.startsWith("custom:")) {
    role = "CUSTOM";
    customRoleId = roleKey.slice("custom:".length);
  } else {
    // lite-member (and any future key the enum cannot carry).
    return null;
  }

  return {
    id: grant.grantId,
    organizationId,
    userId: principal.type === "user" ? principal.id : null,
    groupId: principal.type === "group" ? principal.id : null,
    apiKeyId: principal.type === "api_key" ? principal.id : null,
    role,
    customRoleId,
    scopeType: scope.type,
    scopeId: scope.id,
  };
}
