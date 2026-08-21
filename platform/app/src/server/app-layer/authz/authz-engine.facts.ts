/**
 * The authz-engine migration's fact assembly (ADR-110): every legacy table
 * translated into the grant and role facts the ledger states. Pure — no
 * store, no ledger, no clock — which is what keeps each pass's expected
 * state a function of the legacy rows it read. The migration itself lives
 * in ./authz-engine.migration.ts; the proof over these facts in
 * ./authz-engine.check.ts.
 *
 * @see specs/migration/authz-grants-rollout.feature
 */

import { roleKeyForTeamRole } from "@langwatch/authz";
import type {
  ExternalMemberFact,
  GrantFact,
  LedgerPrincipal,
  LegacyBindingRow,
  LegacyRoleRow,
  LegacyTeamRow,
  OrganizationMemberFact,
  ProjectCredentialFact,
  RoleFact,
  ShareLinkFactRow,
} from "@langwatch/authz-server";
import {
  SHARE_LINK_PERMISSION,
  shareVisibilityAudience,
} from "@langwatch/authz-server";
import { deriveGrantId } from "@langwatch/authz-server/migration";

/**
 * The sources this migration owns in the Grant head — its own, plus the
 * three-stage rollout's it replaces (ADR-110 collapsed genesis-import,
 * backfill-b and cutover-import into this one migration; rows they wrote
 * are this migration's to reconcile and to prove).
 */
export const MIGRATION_OWNED_SOURCES = [
  "migration",
  "genesis-import",
  "backfill-b",
  "cutover-import",
] as const;

export function isMigrationOwned(source: string): boolean {
  return (MIGRATION_OWNED_SOURCES as readonly string[]).includes(source);
}

/** Whether one binding row covers one user — named directly, or held
 *  through a group the user belongs to. */
export type BindingCoverage = (args: {
  row: LegacyBindingRow;
  userId: string;
}) => boolean;

/**
 * The coverage predicate, built once per organization from its group
 * memberships. The legacy resolver reads a group-held binding exactly like a
 * user-held one, so every rule phrased as "this user already holds a
 * binding" — the team-membership suppression AND the admin fallback — has to
 * read them the same way. Two predicates that disagree would state a fact on
 * one path that the other suppresses.
 */
function bindingCoverage({
  groupMemberships,
}: {
  groupMemberships: Array<{ userId: string; groupId: string }>;
}): BindingCoverage {
  const groupsByUser = new Map<string, Set<string>>();
  for (const membership of groupMemberships) {
    const groups = groupsByUser.get(membership.userId) ?? new Set<string>();
    groups.add(membership.groupId);
    groupsByUser.set(membership.userId, groups);
  }
  return ({ row, userId }) => {
    if (row.userId === userId) return true;
    return (
      row.groupId !== null &&
      (groupsByUser.get(userId)?.has(row.groupId) ?? false)
    );
  };
}

export type ExpectedShareLink = { row: ShareLinkFactRow; fact: GrantFact };

export type ExpectedFacts = {
  roles: RoleFact[];
  bindingFacts: GrantFact[];
  teamFacts: GrantFact[];
  organizationFacts: GrantFact[];
  credentialFacts: GrantFact[];
  shareLinks: ExpectedShareLink[];
  /** Every non-resource fact, for the proof's walk. */
  nonResourceFacts: GrantFact[];
  /** Every expected id, resource included, for the deny sweep. */
  grantIds: Set<string>;
  /** Ids of legacy rows the migration READ but chose not to express (a
   *  binding naming no principal). Legacy still HAS these rows, so the
   *  deny sweep must not treat an earlier import of one as stale. */
  retainedGrantIds: Set<string>;
};

export function assembleFacts({
  organizationId,
  inventory,
}: {
  organizationId: string;
  inventory: {
    organizationCreatedAtMs: number | null;
    roleRows: LegacyRoleRow[];
    bindingRows: LegacyBindingRow[];
    members: OrganizationMemberFact[];
    teamRows: LegacyTeamRow[];
    shareLinkRows: ShareLinkFactRow[];
    externalMembers: ExternalMemberFact[];
    credentials: ProjectCredentialFact[];
    groupMemberships: Array<{ userId: string; groupId: string }>;
  };
}): ExpectedFacts {
  const roles = inventory.roleRows
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(legacyRoleToFact);
  const bindingFacts = inventory.bindingRows
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((row) => {
      const fact = bindingToFact({ row });
      return fact ? [fact] : [];
    });
  // One coverage predicate for both suppression rules below: a user is
  // "already bound" identically whether the binding names them or a group
  // they belong to, and the two rules must never disagree about that.
  const covers = bindingCoverage({
    groupMemberships: inventory.groupMemberships,
  });
  const teamFacts = teamMembershipFacts({
    organizationId,
    teamRows: inventory.teamRows,
    bindingRows: inventory.bindingRows,
    covers,
  });
  const organizationFacts = organizationLevelFacts({
    organizationId,
    members: inventory.members,
    externalMembers: inventory.externalMembers,
    bindingRows: inventory.bindingRows,
    covers,
    organizationCreatedAtMs: inventory.organizationCreatedAtMs,
  });
  const credentialFacts = inventory.credentials
    .slice()
    .sort((a, b) => a.projectId.localeCompare(b.projectId))
    .map((credential) => credentialToFact({ organizationId, credential }));
  const shareLinks = inventory.shareLinkRows
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (row): ExpectedShareLink => ({
        row,
        fact: shareLinkToFact({ organizationId, row }),
      }),
    );

  const nonResourceFacts = [
    ...bindingFacts,
    ...teamFacts,
    ...organizationFacts,
    ...credentialFacts,
  ];
  return {
    roles,
    bindingFacts,
    teamFacts,
    organizationFacts,
    credentialFacts,
    shareLinks,
    nonResourceFacts,
    grantIds: new Set([
      ...nonResourceFacts.map((fact) => fact.grantId),
      ...shareLinks.map((link) => link.row.id),
    ]),
    retainedGrantIds: new Set(
      inventory.bindingRows
        .filter((row) => bindingPrincipal(row) === null)
        .map((row) => row.id),
    ),
  };
}

/**
 * A CustomRole as the ledger defines it, adopting the row's own id. The
 * stored permissions column is jsonb: anything that is not an array of
 * strings imports as the empty list, which grants nothing.
 */
function legacyRoleToFact(row: LegacyRoleRow): RoleFact {
  return {
    roleId: row.id,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    permissions: permissionStrings(row.permissions),
    kind: row.kind === "system_api_key" ? "system_api_key" : "custom",
    occurredAtMs: row.createdAtMs,
  };
}

export function permissionStrings(stored: unknown): string[] {
  return Array.isArray(stored)
    ? stored.filter(
        (entry): entry is string => typeof entry === "string" && entry !== "",
      )
    : [];
}

/**
 * A RoleBinding as the ledger attaches it. The grant id IS the row id. A row
 * naming no principal cannot be expressed as a grant and is skipped; the
 * proof does not expect it either, so it holds nothing up.
 *
 * A custom key erases which legacy `role` column value the row carried, so
 * it travels as `legacyRole`: the legacy resolver falls back to that column
 * whenever the custom role's permission list is empty, and dropping it would
 * turn an ADMIN with an empty custom role into a viewer.
 */
function bindingToFact({ row }: { row: LegacyBindingRow }): GrantFact | null {
  const principal = bindingPrincipal(row);
  if (!principal) return null;
  return {
    grantId: row.id,
    principal,
    roleKey:
      row.customRoleId === null
        ? roleKeyForTeamRole(row.role)
        : `custom:${row.customRoleId}`,
    ...(row.customRoleId === null ? {} : { legacyRole: row.role }),
    scope: { type: row.scopeType, id: row.scopeId },
    source: "migration",
    occurredAtMs: row.createdAtMs,
  };
}

function bindingPrincipal(row: LegacyBindingRow): LedgerPrincipal | null {
  if (row.userId !== null) return { type: "user", id: row.userId };
  if (row.groupId !== null) return { type: "group", id: row.groupId };
  if (row.apiKeyId !== null) return { type: "apiKey", id: row.apiKeyId };
  return null;
}

/**
 * Team memberships stated DIRECTLY (ADR-110), never promoted into binding
 * rows first — and only where the legacy resolver actually grants from
 * them. Its predicate, mirrored exactly:
 *
 * - A membership is suppressed when the user holds ANY binding at the
 *   scopes in play (the organization, or the membership's own team) —
 *   directly or through a group. The resolver counts a binding of any role
 *   there, so the suppression must not key on role: keeping a role in the
 *   key stated an EXTRA grant beside a differing-role binding, a union the
 *   legacy path never answers.
 * - A `CUSTOM` membership row is never stated: the resolver's fallback
 *   denies that shape outright ("leave those to the binding path"), with
 *   or without an assigned role, so a fact for it would grant access
 *   legacy refuses.
 */
function teamMembershipFacts({
  organizationId,
  teamRows,
  bindingRows,
  covers,
}: {
  organizationId: string;
  teamRows: LegacyTeamRow[];
  bindingRows: LegacyBindingRow[];
  covers: BindingCoverage;
}): GrantFact[] {
  const suppressed = ({ userId, teamId }: { userId: string; teamId: string }) =>
    bindingRows.some((row) => {
      const inPlay =
        (row.scopeType === "ORGANIZATION" && row.scopeId === organizationId) ||
        (row.scopeType === "TEAM" && row.scopeId === teamId);
      return inPlay && covers({ row, userId });
    });
  return teamRows
    .slice()
    .sort(
      (a, b) =>
        a.teamId.localeCompare(b.teamId) || a.userId.localeCompare(b.userId),
    )
    .flatMap((row) => {
      if (row.role === "CUSTOM") return [];
      if (suppressed(row)) return [];
      const principal = { type: "user" as const, id: row.userId };
      const scope = { type: "TEAM" as const, id: row.teamId };
      return [
        {
          grantId: deriveGrantId({
            organizationId,
            principal,
            scope,
            occurredAtMs: row.createdAtMs,
          }),
          principal,
          roleKey: roleKeyForTeamRole(row.role),
          scope,
          source: "migration" as const,
          occurredAtMs: row.createdAtMs,
        },
      ];
    });
}

/**
 * The facts the legacy schema inferred instead of storing.
 *
 * The floor: one org-scoped `member` grant whose principal is the
 * organization's membership itself, so a member holding no binding anywhere
 * holds exactly the floor and nothing beyond it.
 *
 * The legacy-admin fallback: an ADMIN with no binding anywhere is served
 * today by the resolver's fallback. `legacy-admin`, NOT `admin`, and the
 * difference is load-bearing: `admin` would grant the full admin bag where
 * the fallback grants a narrower one; the untranslatable key keeps the fact
 * dormant until the contract gives it the bag the fallback actually grants.
 *
 * Lite members: `OrganizationUser.role = EXTERNAL`, the org-scoped cap the
 * legacy schema kept as a membership column.
 */
function organizationLevelFacts({
  organizationId,
  members,
  externalMembers,
  bindingRows,
  covers,
  organizationCreatedAtMs,
}: {
  organizationId: string;
  members: OrganizationMemberFact[];
  externalMembers: ExternalMemberFact[];
  bindingRows: LegacyBindingRow[];
  covers: BindingCoverage;
  organizationCreatedAtMs: number | null;
}): GrantFact[] {
  const scope = { type: "ORGANIZATION" as const, id: organizationId };
  const facts: GrantFact[] = [];

  if (organizationCreatedAtMs !== null) {
    const principal = { type: "organization" as const, id: organizationId };
    facts.push({
      grantId: deriveGrantId({
        organizationId,
        principal,
        scope,
        occurredAtMs: organizationCreatedAtMs,
      }),
      principal,
      roleKey: "member",
      scope,
      source: "migration",
      occurredAtMs: organizationCreatedAtMs,
    });
  }

  for (const member of members
    .slice()
    .sort((a, b) => a.userId.localeCompare(b.userId))) {
    if (member.role !== "ADMIN") continue;
    // "No binding anywhere" reads group-held bindings too — the same
    // predicate the team-membership suppression uses.
    if (bindingRows.some((row) => covers({ row, userId: member.userId })))
      continue;
    const principal = { type: "user" as const, id: member.userId };
    facts.push({
      grantId: deriveGrantId({
        organizationId,
        principal,
        scope,
        occurredAtMs: member.createdAtMs,
      }),
      principal,
      roleKey: "legacy-admin",
      scope,
      source: "migration",
      occurredAtMs: member.createdAtMs,
    });
  }

  for (const member of externalMembers
    .slice()
    .sort((a, b) => a.userId.localeCompare(b.userId))) {
    const principal = { type: "user" as const, id: member.userId };
    facts.push({
      grantId: deriveGrantId({
        organizationId,
        principal,
        scope,
        occurredAtMs: member.createdAtMs,
      }),
      principal,
      roleKey: "lite-member",
      scope,
      source: "migration",
      occurredAtMs: member.createdAtMs,
    });
  }
  return facts;
}

/** The legacy per-project credential (`Project.apiKey`): the PROJECT itself
 *  is the principal — that key authenticates as the project and names no
 *  user or key row at all. */
function credentialToFact({
  organizationId,
  credential,
}: {
  organizationId: string;
  credential: ProjectCredentialFact;
}): GrantFact {
  const principal = { type: "project" as const, id: credential.projectId };
  const scope = { type: "PROJECT" as const, id: credential.projectId };
  return {
    grantId: deriveGrantId({
      organizationId,
      principal,
      scope,
      occurredAtMs: credential.createdAtMs,
    }),
    principal,
    roleKey: "admin",
    scope,
    source: "migration",
    occurredAtMs: credential.createdAtMs,
  };
}

/** A share link as the ledger attaches it, adopting the row's own id so the
 *  token a customer already circulated keeps resolving to it. Resource facts
 *  carry no role: their single permission is in the terms. */
function shareLinkToFact({
  organizationId,
  row,
}: {
  organizationId: string;
  row: ShareLinkFactRow;
}): GrantFact {
  return {
    grantId: row.id,
    principal: shareVisibilityAudience({
      visibility: row.visibility,
      organizationId,
      projectId: row.projectId,
    }),
    roleKey: null,
    scope: { type: "RESOURCE", id: row.resourceId },
    resource: {
      kind: row.resourceType === "THREAD" ? "thread" : "trace",
      projectId: row.projectId,
      token: row.token,
      permission: SHARE_LINK_PERMISSION,
      ...(row.userId === null ? {} : { createdByUserId: row.userId }),
      ...(row.expiresAtMs === null ? {} : { expiresAtMs: row.expiresAtMs }),
      ...(row.maxViews === null ? {} : { maxViews: row.maxViews }),
    },
    source: "migration",
    occurredAtMs: row.createdAtMs,
  };
}
