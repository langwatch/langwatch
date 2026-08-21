/**
 * ADR-110 — the one migration that moves an organization onto the grants
 * engine. Every legacy table is a source of facts; the migration states each
 * row as an event, checks once that the projection agrees with what it
 * stated, and finishing IS the switch: the moment this returns `finalized`
 * the engine gate answers permission checks from the projection
 * (engine-gate.ts reads this migration's status and nothing else).
 *
 * Adoption, not re-creation. A fact with a legacy row of its own — a
 * RoleBinding, a CustomRole, a ShareLink — keeps that row's id, because the
 * id is the upstream identity the REST surface already returns to customers.
 * A fact the legacy schema only INFERRED — the org-member floor, the
 * legacy-admin fallback, a lite member, a team membership with no binding, a
 * project credential — derives its id from its content (`deriveGrantId`), so
 * every pass derives the same id for the same fact.
 *
 * Idempotent by construction, not by bookkeeping: each pass re-reads the
 * legacy tables, restates every fact (command ids are content-derived, so a
 * restated fact dedupes at the event store and a CHANGED one appends), emits
 * compensating revocations for facts whose legacy row is gone, and proves
 * the heads against the rows it just read. Nothing here consults `previous`;
 * there is no partial state a failed pass could leave behind that the next
 * full pass does not simply redo.
 *
 * The migration does not wait (ADR-110): it cannot write the projection —
 * it can only state events — so it checks once and reports. A projection
 * that has not caught up is a HELD organization (`migrated`), not an error:
 * the next pass revisits it and the check heals as the fold drains. A head
 * that disagrees with legacy on a field is also held, with the disagreement
 * named in the report.
 *
 * Nothing legacy changes before an organization finalizes: the projection's
 * compat writes are update-only for migration-sourced facts (see
 * authz-grants-write.prisma.repository.ts), so an adopted row converges onto
 * itself and a derived fact — whose legacy representation is the membership
 * or credential row it came from — creates no binding row at all.
 *
 * @see specs/migration/authz-grants-rollout.feature
 * @see dev/docs/adr/110-grant-aggregates-are-grants.md
 */
import { createHash } from "node:crypto";
import { roleKeyForTeamRole } from "@langwatch/authz";
import type {
  ExternalMemberFact,
  GrantFact,
  GrantsLedgerActor,
  LedgerPrincipal,
  LegacyBindingRow,
  LegacyRoleRow,
  LegacyTeamRow,
  OrganizationMemberFact,
  ProjectCredentialFact,
  ResourceGrantRow,
  ResourceGrantUsageSeed,
  RoleFact,
  RoleHeadRow,
  ShareLinkFactRow,
} from "@langwatch/authz-server";
import {
  PRINCIPAL_TO_DB,
  SHARE_LINK_PERMISSION,
  shareVisibilityAudience,
} from "@langwatch/authz-server";
import {
  bindingIdentityKey,
  deriveGrantId,
} from "@langwatch/authz-server/migration";
import type {
  SystemMigration,
  TenantMigrationOutcome,
} from "@langwatch/system-migrations";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "./migration-name";

/** The system actor on every fact this migration authors: no human did it. */
export const AUTHZ_ENGINE_ACTOR_ID = "system:authz-engine" as const;

const ACTOR: GrantsLedgerActor = {
  type: "system",
  id: AUTHZ_ENGINE_ACTOR_ID,
};

/** Commands in flight at once. Sends are queue enqueues, so this bounds
 *  memory and connection pressure, not throughput. */
const SEND_CONCURRENCY = 100;

/** A held report names a SAMPLE, not the world: the count is the size of the
 *  problem, the sample is enough to find it. */
const MAX_REPORTED = 50;

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

/** One non-resource Grant head row, as the proof reads it. */
export type GrantHeadRow = {
  id: string;
  principalType: string;
  principalId: string | null;
  roleKey: string | null;
  legacyRole: string | null;
  source: string;
  scopeType: string;
  scopeId: string;
  revoked: boolean;
};

/** One named disagreement between a head and the legacy row it mirrors. */
export type AuthzEngineDiff = {
  kind:
    | "grant_missing"
    | "grant_revoked"
    | "grant_changed"
    | "grant_extra"
    | "role_missing"
    | "role_changed"
    | "role_extra"
    | "resource_missing"
    | "resource_changed";
  id: string;
  field?: string;
  expected?: string | null;
  actual?: string | null;
};

/**
 * The legacy inventory and the head reads, all on the Prisma migration
 * repository. Inventory reads are deliberately unfenced — this repository's
 * job is what the organization HAS; the head reads fence on live rows
 * themselves.
 */
export interface AuthzEngineMigrationStore {
  findOrganizationCreatedAtMs(args: {
    organizationId: string;
  }): Promise<number | null>;
  findLegacyRoleRows(args: {
    organizationId: string;
  }): Promise<LegacyRoleRow[]>;
  findLegacyBindingRows(args: {
    organizationId: string;
  }): Promise<LegacyBindingRow[]>;
  findOrganizationMembers(args: {
    organizationId: string;
  }): Promise<OrganizationMemberFact[]>;
  findLegacyTeamRows(args: {
    organizationId: string;
  }): Promise<LegacyTeamRow[]>;
  findShareLinkRows(args: {
    organizationId: string;
  }): Promise<ShareLinkFactRow[]>;
  findExternalMemberFacts(args: {
    organizationId: string;
  }): Promise<ExternalMemberFact[]>;
  findProjectCredentialFacts(args: {
    organizationId: string;
  }): Promise<ProjectCredentialFact[]>;

  findRoleHeads(args: { organizationId: string }): Promise<RoleHeadRow[]>;
  findGrantHeadRows(args: { organizationId: string }): Promise<GrantHeadRow[]>;
  findResourceGrantRows(args: {
    organizationId: string;
  }): Promise<ResourceGrantRow[]>;
  seedResourceGrantUsage(args: {
    organizationId: string;
    seeds: readonly ResourceGrantUsageSeed[];
  }): Promise<void>;
}

/**
 * The migration's door into the ledger — one command, one entity (ADR-110).
 * A send while the queue is unavailable throws `AuthzLedgerUnavailableError`,
 * which parks the organization naming the queue as the cause; the runner
 * retries on a later pass.
 */
export interface AuthzEngineLedger {
  attachGrant(args: {
    organizationId: string;
    commandId: string;
    grant: GrantFact & { actor: GrantsLedgerActor };
  }): Promise<void>;
  defineRole(args: {
    organizationId: string;
    commandId: string;
    role: RoleFact;
    actor: GrantsLedgerActor;
  }): Promise<void>;
  changeGrantRole(args: {
    organizationId: string;
    commandId: string;
    grantId: string;
    from: string | null;
    to: string;
    actor: GrantsLedgerActor;
    occurredAtMs: number;
  }): Promise<void>;
  changeRolePermissions(args: {
    organizationId: string;
    commandId: string;
    roleId: string;
    permissions: string[];
    actor: GrantsLedgerActor;
    occurredAtMs: number;
  }): Promise<void>;
  revokeGrant(args: {
    organizationId: string;
    commandId: string;
    grantId: string;
    reason: string;
    actor: GrantsLedgerActor;
    occurredAtMs: number;
  }): Promise<void>;
  deleteRole(args: {
    organizationId: string;
    commandId: string;
    roleId: string;
    actor: GrantsLedgerActor;
    occurredAtMs: number;
  }): Promise<void>;
}

export type AuthzEngineMigrationDeps = {
  store: AuthzEngineMigrationStore;
  ledger: AuthzEngineLedger;
  now: () => number;
};

export class AuthzEngineMigration implements SystemMigration {
  readonly name = AUTHZ_ENGINE_MIGRATION_NAME;
  readonly title = "Authorization engine";
  readonly description =
    "Turns each organization's existing access into the authorization " +
    "engine's own records, verifies the engine gives the same answers, and " +
    "then has the engine answer permission checks for that organization.";
  // Finalizing changes who answers permission checks for the organization,
  // so an operator action on it takes the typed destructive confirmation.
  readonly requiresOperatorConfirmation = true;
  // Cloud soaks first (per-organization enrollment); a later release flips
  // this once it has. Flipping it IS the self-hosted release act.
  readonly runsAutomaticallyOnSelfHosted = false;

  constructor(private readonly deps: AuthzEngineMigrationDeps) {}

  async migrateTenant({
    tenantId,
    signal,
  }: {
    tenantId: string;
    signal?: AbortSignal;
  }): Promise<TenantMigrationOutcome> {
    const organizationId = tenantId;
    const inventory = await this.readInventory(organizationId);
    const expected = assembleFacts({ organizationId, inventory });

    // The projection, read ONCE per pass (the spec's own words) — before
    // anything is stated, so nothing here waits on a fold. Reconcile and the
    // check both walk this read: what this pass states is invisible to it by
    // construction, lands as `outstanding`, and the NEXT pass sees it folded
    // and finalizes. Holding a first pass to finalize a later one is the
    // design, not a shortcut.
    const heads = await this.readHeads(organizationId);

    await this.state({ organizationId, expected, signal });
    await this.reconcile({ organizationId, expected, heads, signal });
    // The budget handover rides every pass, monotonically upward: legacy
    // keeps counting views while the organization is held, and the proof
    // compares counts exactly, so re-seeding is what lets it heal.
    await this.deps.store.seedResourceGrantUsage({
      organizationId,
      seeds: expected.shareLinks.map((link) => ({
        grantId: link.row.id,
        projectId: link.row.projectId,
        viewCount: link.row.viewCount,
      })),
    });

    const { outstanding, diffs } = this.check({
      organizationId,
      expected,
      heads,
    });

    const counts = {
      roles: expected.roles.length,
      bindings: expected.bindingFacts.length,
      teamMemberships: expected.teamFacts.length,
      organizationFacts: expected.organizationFacts.length,
      projectCredentials: expected.credentialFacts.length,
      shareLinks: expected.shareLinks.length,
    };
    if (outstanding.length > 0 || diffs.length > 0) {
      return {
        status: "migrated",
        report: {
          kind: "authz_engine_held",
          ...counts,
          outstanding: outstanding.length,
          outstandingSample: outstanding.slice(0, MAX_REPORTED),
          totalDiffs: diffs.length,
          diffs: diffs.slice(0, MAX_REPORTED),
        },
      };
    }
    return { status: "finalized", report: { kind: "authz_engine", ...counts } };
  }

  private async readInventory(organizationId: string) {
    const [
      organizationCreatedAtMs,
      roleRows,
      bindingRows,
      members,
      teamRows,
      shareLinkRows,
      externalMembers,
      credentials,
    ] = await Promise.all([
      this.deps.store.findOrganizationCreatedAtMs({ organizationId }),
      this.deps.store.findLegacyRoleRows({ organizationId }),
      this.deps.store.findLegacyBindingRows({ organizationId }),
      this.deps.store.findOrganizationMembers({ organizationId }),
      this.deps.store.findLegacyTeamRows({ organizationId }),
      this.deps.store.findShareLinkRows({ organizationId }),
      this.deps.store.findExternalMemberFacts({ organizationId }),
      this.deps.store.findProjectCredentialFacts({ organizationId }),
    ]);
    return {
      organizationCreatedAtMs,
      roleRows,
      bindingRows,
      members,
      teamRows,
      shareLinkRows,
      externalMembers,
      credentials,
    };
  }

  private async readHeads(organizationId: string): Promise<HeadState> {
    const [grantRows, roleHeads, resourceRows] = await Promise.all([
      this.deps.store.findGrantHeadRows({ organizationId }),
      this.deps.store.findRoleHeads({ organizationId }),
      this.deps.store.findResourceGrantRows({ organizationId }),
    ]);
    return { grantRows, roleHeads, resourceRows };
  }

  /** Roles before grants: a custom binding's roleKey names its role. */
  private async state({
    organizationId,
    expected,
    signal,
  }: {
    organizationId: string;
    expected: ExpectedFacts;
    signal?: AbortSignal;
  }): Promise<void> {
    await this.each(expected.roles, signal, (role) =>
      this.deps.ledger.defineRole({
        organizationId,
        commandId: contentCommandId("role", role.roleId, role),
        role,
        actor: ACTOR,
      }),
    );
    const grants = [
      ...expected.bindingFacts,
      ...expected.teamFacts,
      ...expected.organizationFacts,
      ...expected.credentialFacts,
      ...expected.shareLinks.map((link) => link.fact),
    ];
    await this.each(grants, signal, (fact) =>
      this.deps.ledger.attachGrant({
        organizationId,
        commandId: contentCommandId("grant", fact.grantId, fact),
        grant: { ...fact, actor: ACTOR },
      }),
    );
  }

  /**
   * The deny direction, plus drift repair — both diffs of the heads against
   * the rows this pass just read.
   *
   * A legacy row deleted while the organization was off the engine has no
   * event of its own (legacy deletes are imperative row-deletes), so any
   * migration-owned head fact whose legacy row is gone gets a compensating
   * revocation. Safe without waiting on the projection: it only ever names
   * ids the head ALREADY carries, so a fact stated moments ago is simply
   * not a candidate.
   *
   * Drift repair covers the two legacy mutations that happen in place: a
   * binding's role reassignment and a custom role's permission edit. Both
   * are stated as their proper change events with today's business time —
   * a restated `attach`/`define` cannot carry them, because the head's
   * upsert guard refuses an event that is not strictly newer than the row,
   * and an adopted fact's business time is pinned to the legacy row's
   * createdAt. Anything else that drifts is not repaired here; the proof
   * names it and the organization stays held for an operator to read.
   */
  private async reconcile({
    organizationId,
    expected,
    heads,
    signal,
  }: {
    organizationId: string;
    expected: ExpectedFacts;
    heads: HeadState;
    signal?: AbortSignal;
  }): Promise<void> {
    const { grantRows: headRows, roleHeads } = heads;
    const occurredAtMs = this.deps.now();

    const ownedLive = headRows.filter(
      (row) => isMigrationOwned(row.source) && !row.revoked,
    );
    const staleGrants = ownedLive
      .filter((row) => !expected.grantIds.has(row.id))
      .map((row) => row.id)
      .sort();
    await this.each(staleGrants, signal, (grantId) =>
      this.deps.ledger.revokeGrant({
        organizationId,
        commandId: `authz-engine:deny:grant:${grantId}`,
        grantId,
        reason: "authz-engine reconciliation: legacy row no longer exists",
        actor: ACTOR,
        occurredAtMs,
      }),
    );

    const expectedRoleIds = new Set(expected.roles.map((role) => role.roleId));
    const staleRoles = roleHeads
      .filter((head) => head.kind === "custom" && !expectedRoleIds.has(head.id))
      .map((head) => head.id)
      .sort();
    await this.each(staleRoles, signal, (roleId) =>
      this.deps.ledger.deleteRole({
        organizationId,
        commandId: `authz-engine:deny:role:${roleId}`,
        roleId,
        actor: ACTOR,
        occurredAtMs,
      }),
    );

    const headById = new Map(headRows.map((row) => [row.id, row]));
    const rekeys = expected.nonResourceFacts.flatMap((fact) => {
      const head = headById.get(fact.grantId);
      if (!head || head.revoked) return [];
      if (fact.roleKey === null || head.roleKey === fact.roleKey) return [];
      return [{ grantId: fact.grantId, from: head.roleKey, to: fact.roleKey }];
    });
    await this.each(rekeys, signal, (rekey) =>
      this.deps.ledger.changeGrantRole({
        organizationId,
        commandId: contentCommandId("rekey", rekey.grantId, rekey.to),
        grantId: rekey.grantId,
        from: rekey.from,
        to: rekey.to,
        actor: ACTOR,
        occurredAtMs,
      }),
    );

    const roleHeadById = new Map(roleHeads.map((head) => [head.id, head]));
    const reperms = expected.roles.flatMap((role) => {
      const head = roleHeadById.get(role.roleId);
      if (!head) return [];
      const headPermissions = permissionStrings(head.permissions);
      if (headPermissions.join(",") === role.permissions.join(",")) return [];
      return [{ roleId: role.roleId, permissions: role.permissions }];
    });
    await this.each(reperms, signal, (reperm) =>
      this.deps.ledger.changeRolePermissions({
        organizationId,
        commandId: contentCommandId(
          "reperm",
          reperm.roleId,
          reperm.permissions,
        ),
        roleId: reperm.roleId,
        permissions: reperm.permissions,
        actor: ACTOR,
        occurredAtMs,
      }),
    );
  }

  /**
   * The check, over the pass's one projection read (ADR-110: the migration
   * does not wait). What that read cannot see is `outstanding` — facts this
   * pass stated, and revocations it sent; a later pass sees them folded.
   * What it sees and disagrees with is a `diff`, named so an operator can
   * act on it.
   */
  private check({
    organizationId,
    expected,
    heads,
  }: {
    organizationId: string;
    expected: ExpectedFacts;
    heads: HeadState;
  }): { outstanding: string[]; diffs: AuthzEngineDiff[] } {
    const { grantRows: headRows, roleHeads, resourceRows } = heads;
    const outstanding: string[] = [];
    const diffs: AuthzEngineDiff[] = [];

    const headById = new Map(headRows.map((row) => [row.id, row]));
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
    for (const row of headRows) {
      if (row.revoked || !isMigrationOwned(row.source)) continue;
      // Revoked this pass, not yet folded: outstanding, never a diff.
      if (!expected.grantIds.has(row.id)) outstanding.push(row.id);
    }

    const roleHeadById = new Map(roleHeads.map((head) => [head.id, head]));
    const expectedRoleIds = new Set(expected.roles.map((role) => role.roleId));
    for (const role of expected.roles) {
      const head = roleHeadById.get(role.roleId);
      if (!head) {
        outstanding.push(role.roleId);
        continue;
      }
      diffs.push(...roleDiffs({ role, head }));
    }
    for (const head of roleHeads) {
      if (head.kind === "custom" && !expectedRoleIds.has(head.id)) {
        outstanding.push(head.id);
      }
    }

    const resourceById = new Map(resourceRows.map((row) => [row.grantId, row]));
    const expectedLinkIds = new Set(
      expected.shareLinks.map((link) => link.row.id),
    );
    for (const link of expected.shareLinks) {
      const head = resourceById.get(link.row.id);
      if (!head) {
        outstanding.push(link.row.id);
        continue;
      }
      diffs.push(...resourceDiffs({ organizationId, link, head }));
    }
    for (const row of resourceRows) {
      if (!expectedLinkIds.has(row.grantId)) outstanding.push(row.grantId);
    }

    return { outstanding: outstanding.sort(), diffs };
  }

  /** Bounded fan-out, aborted between chunks — the runner will not
   *  interrupt an in-flight send, so the boundary is the chunk. */
  private async each<T>(
    items: readonly T[],
    signal: AbortSignal | undefined,
    send: (item: T) => Promise<void>,
  ): Promise<void> {
    for (let i = 0; i < items.length; i += SEND_CONCURRENCY) {
      if (signal?.aborted) {
        throw new Error(
          "authz-engine migration aborted; organization parked for retry",
        );
      }
      await Promise.all(items.slice(i, i + SEND_CONCURRENCY).map(send));
    }
  }
}

type HeadState = {
  grantRows: GrantHeadRow[];
  roleHeads: RoleHeadRow[];
  resourceRows: ResourceGrantRow[];
};

type ExpectedShareLink = { row: ShareLinkFactRow; fact: GrantFact };

type ExpectedFacts = {
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
};

function assembleFacts({
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
  const teamFacts = teamMembershipFacts({
    organizationId,
    teamRows: inventory.teamRows,
    bindingRows: inventory.bindingRows,
  });
  const organizationFacts = organizationLevelFacts({
    organizationId,
    members: inventory.members,
    externalMembers: inventory.externalMembers,
    bindingRows: inventory.bindingRows,
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
  };
}

/**
 * A command id derived from the fact's identity AND its content. Identity
 * alone is not enough: the event store dedupes on the idempotency key, so a
 * legacy row edited between two passes would restate under the first pass's
 * key and be silently swallowed. Content in the key means the same fact
 * always dedupes and a changed one always appends.
 */
function contentCommandId(kind: string, id: string, content: unknown): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex")
    .slice(0, 16);
  return `authz-engine:${kind}:${id}:${digest}`;
}

function isMigrationOwned(source: string): boolean {
  return (MIGRATION_OWNED_SOURCES as readonly string[]).includes(source);
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

function permissionStrings(stored: unknown): string[] {
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
 * rows first. A membership a TEAM-scoped binding already carries — same
 * identity the database's partial unique indexes use, role normalized
 * through the same mapping on both sides — is that binding's fact, not a
 * second one.
 */
function teamMembershipFacts({
  organizationId,
  teamRows,
  bindingRows,
}: {
  organizationId: string;
  teamRows: LegacyTeamRow[];
  bindingRows: LegacyBindingRow[];
}): GrantFact[] {
  const bound = new Set(
    bindingRows
      .filter((row) => row.scopeType === "TEAM" && row.userId !== null)
      .map((row) =>
        bindingIdentityKey({
          principal: { userId: row.userId },
          scopeType: "TEAM",
          scopeId: row.scopeId,
          role:
            row.customRoleId === null ? roleKeyForTeamRole(row.role) : row.role,
          customRoleId: row.customRoleId,
        }),
      ),
  );
  return teamRows
    .slice()
    .sort(
      (a, b) =>
        a.teamId.localeCompare(b.teamId) || a.userId.localeCompare(b.userId),
    )
    .flatMap((row) => {
      const key = bindingIdentityKey({
        principal: { userId: row.userId },
        scopeType: "TEAM",
        scopeId: row.teamId,
        role:
          row.customRoleId === null ? roleKeyForTeamRole(row.role) : row.role,
        customRoleId: row.customRoleId,
      });
      if (bound.has(key)) return [];
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
          roleKey:
            row.customRoleId === null
              ? roleKeyForTeamRole(row.role)
              : `custom:${row.customRoleId}`,
          ...(row.customRoleId === null ? {} : { legacyRole: row.role }),
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
  organizationCreatedAtMs,
}: {
  organizationId: string;
  members: OrganizationMemberFact[];
  externalMembers: ExternalMemberFact[];
  bindingRows: LegacyBindingRow[];
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

  const boundUserIds = new Set(
    bindingRows.flatMap((row) => (row.userId === null ? [] : [row.userId])),
  );
  for (const member of members
    .slice()
    .sort((a, b) => a.userId.localeCompare(b.userId))) {
    if (member.role !== "ADMIN" || boundUserIds.has(member.userId)) continue;
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

/** Field equality for one imported link against its RESOURCE head row. The
 *  stored spellings differ (the head keeps the database's uppercase), so the
 *  comparison is against what the import said, mapped to that spelling. */
function resourceDiffs({
  organizationId,
  link,
  head,
}: {
  organizationId: string;
  link: ExpectedShareLink;
  head: ResourceGrantRow;
}): AuthzEngineDiff[] {
  const { row } = link;
  const principal = shareVisibilityAudience({
    visibility: row.visibility,
    organizationId,
    projectId: row.projectId,
  });
  const compared: Array<[string, string | null, string | null]> = [
    ["token", row.token, head.token],
    ["kind", row.resourceType, (head.resourceKind ?? "").toUpperCase() || null],
    ["resourceId", row.resourceId, head.resourceId],
    ["projectId", row.projectId, head.projectId],
    ["principalType", PRINCIPAL_TO_DB[principal.type], head.principalType],
    ["principalId", principal.id, head.principalId],
    ["expiresAt", numberField(row.expiresAtMs), numberField(head.expiresAtMs)],
    ["maxViews", numberField(row.maxViews), numberField(head.maxViews)],
    // The view budget is part of the link, not decoration on it: a link
    // reproduced with the right cap and no views spent is a link the
    // migration refilled. Compared so that never passes silently.
    ["viewCount", numberField(row.viewCount), numberField(head.viewCount)],
  ];
  return compared.flatMap(([field, expected, actual]) =>
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
  );
}

function numberField(value: number | null): string | null {
  return value === null ? null : String(value);
}
