import {
  AUTHZ_SHARE_PERMISSION,
  authzShareAudience,
  PRINCIPAL_KIND_FROM_STORED,
  STORED_PRINCIPAL_KIND,
  storedPrincipalKindSchema,
  storedScopeTierSchema,
} from "@langwatch/authz-contract";
import type {
  GrantEventSource,
  GrantFact,
  LedgerPrincipalType,
  LedgerScopeType,
  LegacyBindingRole,
  ResourceGrantTerms,
  RoleFact,
  StoredPrincipalKind,
  StoredScopeTier,
  TeamUserRole,
} from "@langwatch/authz-contract";
import { fromDate, type Instant, Temporal } from "@langwatch/time";
import { z } from "zod";

/** The single permission a share link has ever conferred (ADR-057) - the one
 *  spelling every minter and every importer of a share-link grant uses
 *  (`cutover.migration.ts`'s import and the platform's `LedgerShareRepository`
 *  mint, both). */
export const SHARE_LINK_PERMISSION = AUTHZ_SHARE_PERMISSION;

/**
 * Pure row mapping: reducer facts ↔ future head (Grant/Role) and compat head
 * (RoleBinding/CustomRole). roleKey translation only here (ADR-070).
 */

/** The Grant table's principal and scope vocabularies. Both are the stored
 *  spellings from `@langwatch/authz-contract`, not restatements of them — a kind
 *  added to the vocabulary appears in the column type with no edit here. */
export type GrantPrincipalTypeDb = StoredPrincipalKind;
export type GrantScopeTypeDb = StoredScopeTier;

/** Kept as a name because call sites read better for it; the translation
 *  itself is the vocabulary's, so there is no second table to go stale. */
export const PRINCIPAL_TO_DB = STORED_PRINCIPAL_KIND;

const PRINCIPAL_FROM_DB = PRINCIPAL_KIND_FROM_STORED;

/** The Grant table's resource-kind vocabulary. Uppercase, because the
 *  column restates ShareLink's own Prisma enum — same reasoning as
 *  `ShareLinkRow.resourceType` in the read port: the stored spelling is the
 *  stored spelling, and the mapping between it and the ledger's lowercase
 *  one lives at exactly one seam. */
export type GrantResourceKindDb = "TRACE" | "THREAD";

/** The single seam for the ledger's lowercase resource kind ↔ the Grant/
 *  ShareLink tables' uppercase spelling - `authz-read.grants.repository.ts`
 *  imports this rather than keeping its own copy. */
export const RESOURCE_KIND_TO_DB: Record<ResourceGrantTerms["kind"], GrantResourceKindDb> = {
  trace: "TRACE",
  thread: "THREAD",
};

const RESOURCE_KIND_FROM_DB: Record<GrantResourceKindDb, ResourceGrantTerms["kind"]> = {
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
  expiresAt: Instant | null;
  maxViews: number | null;
  occurredAt: Instant;
}

/** Exactly the columns a {@link GrantRowShape} holds, for a read that feeds one. */
export const GRANT_ROW_COLUMNS = {
  id: true,
  organizationId: true,
  principalType: true,
  principalId: true,
  roleKey: true,
  legacyRole: true,
  source: true,
  scopeType: true,
  scopeId: true,
  token: true,
  permission: true,
  resourceKind: true,
  projectId: true,
  createdByUserId: true,
  expiresAt: true,
  maxViews: true,
  occurredAt: true,
} as const;

/** The stored row as Postgres hands it back: Dates, not Instants. */
const storedGrantRowSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    principalType: storedPrincipalKindSchema,
    principalId: z.string().nullable(),
    roleKey: z.string().nullable(),
    legacyRole: z.string().nullable(),
    source: z.string(),
    scopeType: storedScopeTierSchema,
    scopeId: z.string(),
    token: z.string().nullable(),
    permission: z.string().nullable(),
    resourceKind: z.string().nullable(),
    projectId: z.string().nullable(),
    createdByUserId: z.string().nullable(),
    expiresAt: z.date().nullable(),
    maxViews: z.number().nullable(),
    occurredAt: z.date(),
  })
  .strict();

export interface RoleRowShape {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  permissions: string[];
  kind: string;
  occurredAt: Instant;
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
 * ShareLink compat head without viewCount (fold doesn't own it; has its own
 * writer in GrantUsage).
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
 *  so it stays future-head-only. Exported so the read repository's own
 *  (DB-keyed) visibility lookup can be derived from this one rather than
 *  restated - see `SHARE_VISIBILITY_BY_PRINCIPAL_DB` below. */
export const SHARE_VISIBILITY_BY_PRINCIPAL: Partial<
  Record<LedgerPrincipalType, CompatShareLinkRowShape["visibility"]>
> = {
  anyone: "PUBLIC",
  organization: "ORGANIZATION",
  project: "PROJECT",
};

/**
 * Same lookup keyed by stored (uppercase) principal; derived from base
 * lookup so both stay in sync. Accepts any string (ungoverned column).
 */
export const SHARE_VISIBILITY_BY_PRINCIPAL_DB: Record<
  string,
  CompatShareLinkRowShape["visibility"] | undefined
> = Object.fromEntries(
  (
    Object.entries(SHARE_VISIBILITY_BY_PRINCIPAL) as [
      LedgerPrincipalType,
      CompatShareLinkRowShape["visibility"],
    ][]
  ).map(([principalType, visibility]) => [PRINCIPAL_TO_DB[principalType], visibility]),
);

/** ADR-057 visibility → the ledger principal it names, the inverse of
 *  `SHARE_VISIBILITY_BY_PRINCIPAL` above. The one seam a share link's
 *  audience translation lives at: the cutover import and the platform's
 *  `LedgerShareRepository` used to carry the same switch independently. */
export type ShareLinkAudience =
  | { type: "anyone"; id: null }
  | { type: "organization"; id: string }
  | { type: "project"; id: string };

/**
 * Grants and roles between their fact form and the rows that store them,
 * both directions, plus the compat shapes older readers still expect. A
 * fact written one way and read back another is a silent authorisation change.
 */
export class AuthzGrantMapper {
  /**
   * Parse stored TEXT column (no Prisma enum); undefined for unknown values
   * to safely handle stale database rows.
   */
  private static resourceKindFromDb(value: string | null): ResourceGrantTerms["kind"] | undefined {
    if (value === "TRACE" || value === "THREAD") {
      return RESOURCE_KIND_FROM_DB[value];
    }
    return undefined;
  }

  static grantFactToRow({
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
      resourceKind: grant.resource != null ? RESOURCE_KIND_TO_DB[grant.resource.kind] : null,
      projectId: grant.resource?.projectId ?? null,
      createdByUserId: grant.resource?.createdByUserId ?? null,
      expiresAt:
        grant.resource?.expiresAtMs != null
          ? Temporal.Instant.fromEpochMilliseconds(grant.resource.expiresAtMs)
          : null,
      maxViews: grant.resource?.maxViews ?? null,
      occurredAt: Temporal.Instant.fromEpochMilliseconds(grant.occurredAtMs),
    };
  }

  /** A row read with {@link GRANT_ROW_COLUMNS}; throws on one that is not a Grant row. */
  static grantRowFromStored(stored: unknown): GrantRowShape {
    const row = storedGrantRowSchema.parse(stored);
    return {
      ...row,
      expiresAt: row.expiresAt ? fromDate(row.expiresAt) : null,
      occurredAt: fromDate(row.occurredAt),
    };
  }

  static grantRowToFact(row: GrantRowShape): GrantFact {
    const resourceKind = AuthzGrantMapper.resourceKindFromDb(row.resourceKind);
    const fact: GrantFact = {
      grantId: row.id,
      principal: {
        type: PRINCIPAL_FROM_DB[row.principalType],
        id: row.principalId,
      },
      roleKey: row.roleKey,
      scope: { type: row.scopeType as LedgerScopeType, id: row.scopeId },
      source: row.source as GrantEventSource,
      occurredAtMs: row.occurredAt.epochMilliseconds,
    };
    if (row.legacyRole != null) {
      fact.legacyRole = row.legacyRole as LegacyBindingRole;
    }
    // All four identity columns or none, and the kind has to parse as one of
    // the two the tier supports. Partial resource identity is not a grant.
    if (
      row.token != null &&
      row.permission != null &&
      resourceKind !== undefined &&
      row.projectId != null
    ) {
      const resource: NonNullable<GrantFact["resource"]> = {
        kind: resourceKind,
        projectId: row.projectId,
        token: row.token,
        permission: row.permission,
      };
      if (row.createdByUserId != null) {
        resource.createdByUserId = row.createdByUserId;
      }
      if (row.expiresAt != null) resource.expiresAtMs = row.expiresAt.epochMilliseconds;
      if (row.maxViews != null) resource.maxViews = row.maxViews;
      fact.resource = resource;
    }
    return fact;
  }

  static roleFactToRow({
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
      occurredAt: Temporal.Instant.fromEpochMilliseconds(role.occurredAtMs),
    };
  }

  static roleRowToFact(row: RoleRowShape): RoleFact {
    const fact: RoleFact = {
      roleId: row.id,
      name: row.name,
      permissions: row.permissions,
      kind: row.kind as RoleFact["kind"],
      occurredAtMs: row.occurredAt.epochMilliseconds,
    };
    if (row.description != null) fact.description = row.description;
    return fact;
  }

  /**
   * Project legacy-expressible shapes only (scopes ORGANIZATION|TEAM|PROJECT;
   * roleKey mapping with legacyRole fallback for custom bindings).
   */
  static findCompatBindingFromGrantFact({
    grant,
    organizationId,
  }: {
    grant: GrantFact;
    organizationId: string;
  }): CompatBindingRowShape | null {
    const { scope, principal, roleKey } = grant;
    if (scope.type !== "ORGANIZATION" && scope.type !== "TEAM" && scope.type !== "PROJECT") {
      return null;
    }
    if (principal.type !== "user" && principal.type !== "group" && principal.type !== "apiKey") {
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
      apiKeyId: principal.type === "apiKey" ? principal.id : null,
      role,
      customRoleId,
      scopeType: scope.type,
      scopeId: scope.id,
    };
  }

  static shareVisibilityAudience({
    visibility,
    organizationId,
    projectId,
  }: {
    visibility: CompatShareLinkRowShape["visibility"];
    organizationId: string;
    projectId: string;
  }): ShareLinkAudience {
    return authzShareAudience({ visibility, organizationId, projectId });
  }

  /**
   * RESOURCE facts only; other scopes/audiences map to null (silently skipped;
   * legacy table never held them).
   */
  static findCompatShareLinkFromGrantFact({
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
      expiresAt: resource.expiresAtMs != null ? new Date(resource.expiresAtMs) : null,
      maxViews: resource.maxViews ?? null,
    };
  }
}
