import type { TeamUserRole } from "@langwatch/authz";
import type {
  GrantEventSource,
  GrantFact,
  LedgerPrincipalType,
  LedgerScopeType,
  LegacyBindingRole,
  ResourceGrantTerms,
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

/** The Grant table's resource-kind vocabulary. Uppercase, because the
 *  column restates ShareLink's own Prisma enum — same reasoning as
 *  `ShareLinkRow.resourceType` in the read port: the stored spelling is the
 *  stored spelling, and the mapping between it and the ledger's lowercase
 *  one lives at exactly one seam. */
export type GrantResourceKindDb = "TRACE" | "THREAD";

const RESOURCE_KIND_TO_DB: Record<
  ResourceGrantTerms["kind"],
  GrantResourceKindDb
> = {
  trace: "TRACE",
  thread: "THREAD",
};

const RESOURCE_KIND_FROM_DB: Record<
  GrantResourceKindDb,
  ResourceGrantTerms["kind"]
> = {
  TRACE: "trace",
  THREAD: "thread",
};

export interface GrantRowShape {
  id: string;
  organizationId: string;
  principalType: GrantPrincipalTypeDb;
  principalId: string | null;
  roleKey: string | null;
  /** The imported binding's original `role` column — persisted so a
   *  projection reloaded from these rows reconstructs the fact it came from
   *  rather than a lossy copy of it. Null on everything ledger-born. */
  legacyRole: string | null;
  source: string;
  scopeType: GrantScopeTypeDb;
  scopeId: string;
  token: string | null;
  permission: string | null;
  resourceKind: string | null;
  projectId: string | null;
  createdByUserId: string | null;
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
    legacyRole: grant.legacyRole ?? null,
    source: grant.source,
    // The ledger and Prisma scope enums share their five value names.
    scopeType: grant.scope.type,
    scopeId: grant.scope.id,
    token: grant.resource?.token ?? null,
    permission: grant.resource?.permission ?? null,
    resourceKind:
      grant.resource != null ? RESOURCE_KIND_TO_DB[grant.resource.kind] : null,
    projectId: grant.resource?.projectId ?? null,
    createdByUserId: grant.resource?.createdByUserId ?? null,
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
    ...(row.legacyRole != null
      ? { legacyRole: row.legacyRole as LegacyBindingRole }
      : {}),
    // All four identity columns or none: a row missing one of them cannot
    // describe a resource grant, and inventing a default would put a fact in
    // front of the engine that names the wrong thing.
    ...(row.token != null &&
    row.permission != null &&
    row.resourceKind != null &&
    row.projectId != null
      ? {
          resource: {
            kind: RESOURCE_KIND_FROM_DB[row.resourceKind as GrantResourceKindDb],
            projectId: row.projectId,
            token: row.token,
            permission: row.permission,
            ...(row.createdByUserId != null
              ? { createdByUserId: row.createdByUserId }
              : {}),
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
 * member→MEMBER, viewer→VIEWER, custom:<id>→(`legacyRole` ?? CUSTOM, id).
 *
 * That last arm is not cosmetic. `roleKey` alone cannot say which built-in
 * role a custom binding ALSO carried, and the legacy resolver reads it: a
 * custom role with an empty permission list falls through to the row's own
 * `role`, so writing CUSTOM where the legacy row said ADMIN silently
 * downgrades the principal to viewer (matchers.ts, `roleKeyForTeamRole`).
 * Imported facts therefore carry `legacyRole` and the compat row reproduces
 * it; ledger-born custom grants have no legacy row to preserve and stay
 * CUSTOM.
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
    role = grant.legacyRole ?? "CUSTOM";
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

/**
 * The resource tier's compat head: a `ShareLink` row, minus the one column
 * the fold does not own.
 *
 * `viewCount` is deliberately absent from the shape, not merely unset.
 * View accounting has a different writer (ShareService, once per view) and
 * lives in `GrantUsage` (delivery-plan decision 22); a fold that carried the
 * column would reset every share's view budget on each projection pass, and
 * a shape that merely defaulted it would make that one edit away. The
 * column's own default (0) covers the create; the update never names it.
 */
export interface CompatShareLinkRowShape {
  /** The grantId itself — the imported rows ADOPT their ShareLink id, so a
   *  row this mapping names is one the ledger authored or adopted. */
  id: string;
  token: string;
  resourceType: GrantResourceKindDb;
  resourceId: string;
  projectId: string;
  userId: string | null;
  visibility: "PUBLIC" | "ORGANIZATION" | "PROJECT";
  expiresAt: Date | null;
  maxViews: number | null;
}

/** Principal → the ShareLink audience the legacy column spells out. A
 *  resource fact naming any other principal has no legacy audience to be,
 *  so it stays future-head-only. */
const SHARE_VISIBILITY_BY_PRINCIPAL: Partial<
  Record<LedgerPrincipalType, CompatShareLinkRowShape["visibility"]>
> = {
  anyone: "PUBLIC",
  organization: "ORGANIZATION",
  project: "PROJECT",
};

/**
 * RESOURCE facts only. A fact at any other scope, a resource fact carrying
 * no terms, or one whose principal names an audience `ShareVisibility`
 * cannot express maps to null — the caller skips it, silently: these are
 * shapes the legacy table never held, not failures.
 *
 * `organizationId` is taken, not stored: `ShareLink` has no organization
 * column (its tenancy is the project). It is here so the signature matches
 * every other mapping in this file, and so a caller cannot project a row
 * without having resolved the organization it belongs to.
 */
export function grantFactToCompatShareLink({
  grant,
  organizationId: _organizationId,
}: {
  grant: GrantFact;
  organizationId: string;
}): CompatShareLinkRowShape | null {
  const { scope, principal, resource } = grant;
  if (scope.type !== "RESOURCE") return null;
  if (!resource) return null;
  const visibility = SHARE_VISIBILITY_BY_PRINCIPAL[principal.type];
  if (!visibility) return null;

  return {
    id: grant.grantId,
    token: resource.token,
    resourceType: RESOURCE_KIND_TO_DB[resource.kind],
    resourceId: scope.id,
    projectId: resource.projectId,
    userId: resource.createdByUserId ?? null,
    visibility,
    expiresAt:
      resource.expiresAtMs != null ? new Date(resource.expiresAtMs) : null,
    maxViews: resource.maxViews ?? null,
  };
}
