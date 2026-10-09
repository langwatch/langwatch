/**
 * The authz-engine migration's proof (ADR-110): the heads the fold wrote,
 * compared against the facts this pass assembled. Pure functions over one
 * projection read — what they cannot see is `outstanding` (stated but not
 * folded); what they see and disagree with is a named diff. The migration
 * itself lives in ./authz-engine.migration.ts; the facts in
 * ./authz-engine.facts.ts.
 *
 * @see specs/migration/authz-grants-rollout.feature
 */
import { createHash } from "node:crypto";
import type {
  GrantFact,
  GrantHeadRow,
  ResourceGrantRow,
  RoleFact,
  RoleHeadRow,
} from "@langwatch/authz-server";
import {
  PRINCIPAL_TO_DB,
  shareVisibilityAudience,
} from "@langwatch/authz-server";
import {
  type ExpectedFacts,
  type ExpectedShareLink,
  isMigrationOwned,
  permissionStrings,
} from "./authz-engine.facts";

/** One named disagreement between a head and the legacy row it mirrors.
 *  Missing and extra rows are not diffs: they are `outstanding` — the fold
 *  has not caught up with what this pass stated or revoked. */
export type AuthzEngineDiff = {
  kind:
    | "grant_revoked"
    | "grant_changed"
    | "role_changed"
    | "role_deleted"
    | "resource_changed";
  id: string;
  field?: string;
  expected?: string | null;
  actual?: string | null;
};

export type HeadState = {
  grantRows: GrantHeadRow[];
  roleHeads: RoleHeadRow[];
  resourceRows: ResourceGrantRow[];
};

export type CheckResult = { outstanding: string[]; diffs: AuthzEngineDiff[] };

export function checkGrantHeads({
  expected,
  heads,
}: {
  expected: ExpectedFacts;
  heads: HeadState;
}): CheckResult {
  const outstanding: string[] = [];
  const diffs: AuthzEngineDiff[] = [];
  const headById = new Map(heads.grantRows.map((row) => [row.id, row]));
  for (const fact of expected.nonResourceFacts) {
    const head = headById.get(fact.grantId);
    if (!head) {
      outstanding.push(fact.grantId);
      continue;
    }
    if (head.revoked) {
      diffs.push({ kind: "grant_revoked", id: fact.grantId });
      continue;
    }
    diffs.push(...grantDiffs({ fact, head }));
  }
  // Stale rows revoked this pass, not yet folded: outstanding, never a diff.
  // The guard matches the sweep's exactly, `retainedGrantIds` included — a
  // row the sweep deliberately did NOT revoke is never going to disappear
  // from the head, so counting it outstanding would hold the organization
  // for a condition no later pass can clear.
  outstanding.push(
    ...heads.grantRows
      .filter(
        (row) =>
          !row.revoked &&
          isMigrationOwned(row.source) &&
          !expected.grantIds.has(row.id) &&
          !expected.retainedGrantIds.has(row.id),
      )
      .map((row) => row.id),
  );
  return { outstanding, diffs };
}

export function checkRoleHeads({
  expected,
  heads,
}: {
  expected: ExpectedFacts;
  heads: HeadState;
}): CheckResult {
  const outstanding: string[] = [];
  const diffs: AuthzEngineDiff[] = [];
  const headById = new Map(heads.roleHeads.map((head) => [head.id, head]));
  const expectedRoleIds = new Set(expected.roles.map((role) => role.roleId));
  for (const role of expected.roles) {
    const head = headById.get(role.roleId);
    if (!head) {
      outstanding.push(role.roleId);
      continue;
    }
    // A buried head is not agreement, and it is not lag either: the fold has
    // no un-delete — `role.upsert` never touches `deletedAt`, and the delete
    // moved the row's business time past anything a restatement could carry —
    // so the disagreement is named for an operator rather than waited on. The
    // `grant_revoked` treatment, one tier over.
    if (head.deleted) {
      diffs.push({ kind: "role_deleted", id: role.roleId });
      continue;
    }
    diffs.push(...roleDiffs({ role, head }));
  }
  for (const head of heads.roleHeads) {
    // An extra is a head whose legacy row is gone, waiting on the deletion
    // this pass sent. A head ALREADY deleted is that deletion applied, and it
    // never leaves this read — the name a role took stays taken, so the
    // tombstone is permanent — which makes counting it outstanding a hold no
    // later pass can clear.
    if (!head.deleted && !expectedRoleIds.has(head.id)) {
      outstanding.push(head.id);
    }
  }
  return { outstanding, diffs };
}

export function checkResourceHeads({
  organizationId,
  expected,
  heads,
}: {
  organizationId: string;
  expected: ExpectedFacts;
  heads: HeadState;
}): CheckResult {
  const outstanding: string[] = [];
  const diffs: AuthzEngineDiff[] = [];
  const headById = new Map(heads.resourceRows.map((row) => [row.grantId, row]));
  const expectedLinkIds = new Set(
    expected.shareLinks.map((link) => link.row.id),
  );
  for (const link of expected.shareLinks) {
    const head = headById.get(link.row.id);
    if (!head) {
      outstanding.push(link.row.id);
      continue;
    }
    const result = resourceDiffs({ organizationId, link, head });
    outstanding.push(...result.outstanding);
    diffs.push(...result.diffs);
  }
  for (const row of heads.resourceRows) {
    // Only rows the migration owns: a live-write row (a ledger-first share
    // whose compat write was stepped over) is not this migration's to hold
    // an organization on, and never its to revoke.
    if (isMigrationOwned(row.source) && !expectedLinkIds.has(row.grantId)) {
      outstanding.push(row.grantId);
    }
  }
  return { outstanding, diffs };
}

export function roleDrifted({
  role,
  head,
}: {
  role: RoleFact;
  head: RoleHeadRow;
}): boolean {
  return (
    head.name !== role.name ||
    (head.description ?? null) !== (role.description ?? null) ||
    permissionStrings(head.permissions).join(",") !==
      role.permissions.join(",") ||
    (head.kind === "system_api_key" ? "system_api_key" : "custom") !== role.kind
  );
}

/**
 * Whether a live head already disagrees with the fact the migration would
 * state. This is the staging filter's question, and deliberately the same
 * field comparison the check reports on: a fact whose head already matches
 * is one `attachGrant` would restate identically, so "safe to skip" and
 * "neither outstanding nor a diff" must be the SAME condition, or a pass
 * could skip work it then holds the organization for.
 */
export function grantDrifted({
  fact,
  head,
}: {
  fact: GrantFact;
  head: GrantHeadRow;
}): boolean {
  return grantDiffs({ fact, head }).length > 0;
}

/**
 * The same question for a share link against its RESOURCE head. Only the
 * named diffs count: a head whose `viewCount` merely lags the legacy row is
 * `outstanding`, and the budget it waits on rides `seedResourceGrantUsage`
 * on every pass rather than the attach, so restating the attach would not
 * carry it anyway.
 */
export function shareLinkDrifted({
  organizationId,
  link,
  head,
}: {
  organizationId: string;
  link: ExpectedShareLink;
  head: ResourceGrantRow;
}): boolean {
  return resourceDiffs({ organizationId, link, head }).diffs.length > 0;
}

/** Field equality for one stated fact against its head row — against what
 *  the migration SAID, since that is what the head is supposed to hold. */
function grantDiffs({
  fact,
  head,
}: {
  fact: GrantFact;
  head: GrantHeadRow;
}): AuthzEngineDiff[] {
  const compared: Array<[string, string | null, string | null]> = [
    ["principalType", PRINCIPAL_TO_DB[fact.principal.type], head.principalType],
    ["principalId", fact.principal.id, head.principalId],
    ["roleKey", fact.roleKey, head.roleKey],
    ["legacyRole", fact.legacyRole ?? null, head.legacyRole],
    ["scopeType", fact.scope.type, head.scopeType],
    ["scopeId", fact.scope.id, head.scopeId],
  ];
  return compared.flatMap(([field, expected, actual]) =>
    expected === actual
      ? []
      : [
          {
            kind: "grant_changed" as const,
            id: fact.grantId,
            field,
            expected,
            actual,
          },
        ],
  );
}

function roleDiffs({
  role,
  head,
}: {
  role: RoleFact;
  head: RoleHeadRow;
}): AuthzEngineDiff[] {
  const compared: Array<[string, string | null, string | null]> = [
    ["name", role.name, head.name],
    ["description", role.description ?? null, head.description],
    [
      "permissions",
      role.permissions.join(","),
      permissionStrings(head.permissions).join(","),
    ],
    [
      "kind",
      role.kind,
      head.kind === "system_api_key" ? "system_api_key" : "custom",
    ],
  ];
  return compared.flatMap(([field, expected, actual]) =>
    expected === actual
      ? []
      : [
          {
            kind: "role_changed" as const,
            id: role.roleId,
            field,
            expected,
            actual,
          },
        ],
  );
}

/**
 * Field equality for one imported link against its RESOURCE head row, and
 * the id when its head lags. The stored spellings differ (the head keeps
 * the database's uppercase), so the comparison is against what the import
 * said, mapped to that spelling.
 *
 * The view budget cuts both ways. A head BEHIND the legacy count is lag, not
 * a disagreement — reporting it as one made an actively-viewed link re-hold
 * the organization forever — and `migrateTenant` hands the budget over before
 * taking this read, so it should find nothing. A head AHEAD is a budget that
 * grew back, which nothing legitimate produces, so that is a named diff.
 *
 * Two `projectId`s are in play and only one is checked: `head.projectId` is
 * the GRANT row's and the table below compares it; `GrantUsage.projectId` is
 * the budget row's, which `findResourceGrantRows` does not select. So a
 * budget row on the wrong project but at the right count reads as agreement.
 * Deliberate: the seed will not move that row, it fails toward fewer views
 * (the consume fences on the same columns and misses), and holding on it
 * would be a hold no pass could clear.
 *
 * Tokens are bearer credentials and the report is persisted and rendered
 * on the ops page, so a token disagreement reports fingerprints, never the
 * values.
 */
function resourceDiffs({
  organizationId,
  link,
  head,
}: {
  organizationId: string;
  link: ExpectedShareLink;
  head: ResourceGrantRow;
}): CheckResult {
  const { row } = link;
  const principal = shareVisibilityAudience({
    visibility: row.visibility,
    organizationId,
    projectId: row.projectId,
  });
  const compared: Array<[string, string | null, string | null]> = [
    ["token", tokenFingerprint(row.token), tokenFingerprint(head.token)],
    ["kind", row.resourceType, (head.resourceKind ?? "").toUpperCase() || null],
    ["resourceId", row.resourceId, head.resourceId],
    ["projectId", row.projectId, head.projectId],
    ["principalType", PRINCIPAL_TO_DB[principal.type], head.principalType],
    ["principalId", principal.id, head.principalId],
    ["expiresAt", numberField(row.expiresAtMs), numberField(head.expiresAtMs)],
    ["maxViews", numberField(row.maxViews), numberField(head.maxViews)],
  ];
  if (head.viewCount > row.viewCount) {
    compared.push([
      "viewCount",
      numberField(row.viewCount),
      numberField(head.viewCount),
    ]);
  }
  return {
    outstanding: head.viewCount < row.viewCount ? [row.id] : [],
    diffs: compared.flatMap(([field, expected, actual]) =>
      expected === actual
        ? []
        : [
            {
              kind: "resource_changed" as const,
              id: row.id,
              field,
              expected,
              actual,
            },
          ],
    ),
  };
}

function tokenFingerprint(token: string | null): string | null {
  if (token === null) return null;
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

function numberField(value: number | null): string | null {
  return value === null ? null : String(value);
}
