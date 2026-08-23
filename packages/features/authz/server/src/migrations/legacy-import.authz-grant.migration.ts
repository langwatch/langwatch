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
 * prisma.authz-projection.repository.ts), so an adopted row converges onto
 * itself and a derived fact — whose legacy representation is the membership
 * or credential row it came from — creates no binding row at all.
 *
 * Two disagreements are named rather than repaired, deliberately — each
 * holds the organization with a diff an operator reads, and both fail
 * toward LESS access, never more:
 *
 * - A DERIVED fact whose head was revoked and whose legacy source came back
 *   (a membership toggled off and on) re-derives the id of the revoked
 *   head; the restated attach dedupes and would lose the head's guard
 *   anyway, so the check reports `grant_revoked` each pass. Remediation is
 *   the operator's (a projection replay, or withdrawing enrollment until
 *   the toggle settles).
 * - A `custom:<id>` role reassignment cannot be repaired by
 *   `changeGrantRole`, because that event clears `legacyRole` (the
 *   escalation rule in the projection) while the expected fact still
 *   carries it; the check names the `legacyRole` disagreement instead.
 *
 * @see specs/migration/authz-grants-rollout.feature
 * @see dev/docs/adr/110-grant-aggregates-are-grants.md
 */

import { createHash } from "node:crypto";
import {
  AUTHZ_ENGINE_MIGRATION_NAME,
  roleKeyForTeamRole,
  type GrantFact,
  type GrantsLedgerActor,
  type LedgerPrincipal,
  type RoleFact,
} from "@langwatch/authz-contract";
import type {
  SystemMigration,
  TenantMigrationOutcome,
} from "@langwatch/system-migrations";
import type {
  AuthzMigrationRepository,
  ExternalMemberFact,
  GrantHeadRow,
  LegacyBindingRow,
  LegacyRoleRow,
  LegacyTeamRow,
  OrganizationMemberFact,
  ProjectCredentialFact,
  ResourceGrantRow,
  ResourceGrantUsageSeed,
  RoleHeadRow,
  ShareLinkFactRow,
} from "../repositories/authz-migration.repository";
import { deriveGrantId } from "../repositories/eventing/eventing.authz-grant.mapper";
import {
  PRINCIPAL_TO_DB,
  SHARE_LINK_PERMISSION,
  shareVisibilityAudience,
} from "../repositories/prisma/prisma.authz-grant.mapper";

export { AUTHZ_ENGINE_MIGRATION_NAME };

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

export type LegacyImportAuthzGrantMigrationOptions = {
  store: AuthzMigrationRepository;
  ledger: AuthzEngineLedger;
  now: () => number;
};

export class LegacyImportAuthzGrantMigration implements SystemMigration {
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

  static create(
    options: LegacyImportAuthzGrantMigrationOptions,
  ): LegacyImportAuthzGrantMigration {
    return new LegacyImportAuthzGrantMigration(options);
  }

  private constructor(
    private readonly deps: LegacyImportAuthzGrantMigrationOptions,
  ) {}

  async migrateTenant({
    tenantId,
    signal,
  }: {
    tenantId: string;
    signal?: AbortSignal;
  }): Promise<TenantMigrationOutcome> {
    const organizationId = tenantId;
    const inventory = await this.readInventory(organizationId);
    const expected = AuthzExpectedFactsMapper.assemble({
      organizationId,
      inventory,
    });

    // The projection, read ONCE per pass (the spec's own words) — before
    // anything is stated, so nothing here waits on a fold. Reconcile and the
    // check both walk this read: what this pass states is invisible to it by
    // construction, lands as `outstanding`, and the NEXT pass sees it folded
    // and finalizes. Holding a first pass to finalize a later one is the
    // design, not a shortcut.
    const heads = await this.readHeads(organizationId);

    await this.state({ organizationId, expected, signal });
    await this.reconcileStale({ organizationId, expected, heads, signal });
    await this.repairDrift({ organizationId, expected, heads, signal });
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
      groupMemberships,
    ] = await Promise.all([
      this.deps.store.findOrganizationCreatedAtMs({ organizationId }),
      this.deps.store.findLegacyRoleRows({ organizationId }),
      this.deps.store.findLegacyBindingRows({ organizationId }),
      this.deps.store.findOrganizationMembers({ organizationId }),
      this.deps.store.findLegacyTeamRows({ organizationId }),
      this.deps.store.findShareLinkRows({ organizationId }),
      this.deps.store.findExternalMemberFacts({ organizationId }),
      this.deps.store.findProjectCredentialFacts({ organizationId }),
      this.deps.store.findGroupMemberships({ organizationId }),
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
      groupMemberships,
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
    await this.each({
      items: expected.roles,
      signal,
      send: (role) =>
        this.deps.ledger.defineRole({
          organizationId,
          commandId: AuthzMigrationCommandMapper.contentId({
            kind: "role",
            id: role.roleId,
            content: role,
          }),
          role,
          actor: ACTOR,
        }),
    });
    const grants = [
      ...expected.bindingFacts,
      ...expected.teamFacts,
      ...expected.organizationFacts,
      ...expected.credentialFacts,
      ...expected.shareLinks.map((link) => link.fact),
    ];
    await this.each({
      items: grants,
      signal,
      send: (fact) =>
        this.deps.ledger.attachGrant({
          organizationId,
          commandId: AuthzMigrationCommandMapper.contentId({
            kind: "grant",
            id: fact.grantId,
            content: fact,
          }),
          grant: { ...fact, actor: ACTOR },
        }),
    });
  }

  /**
   * The deny direction: a legacy row deleted while the organization was off
   * the engine has no event of its own (legacy deletes are imperative
   * row-deletes), so any migration-owned head fact whose legacy row is gone
   * gets a compensating revocation. Safe without waiting on the projection:
   * it only ever names ids the head ALREADY carries, so a fact stated
   * moments ago is simply not a candidate.
   */
  private async reconcileStale({
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
    const occurredAtMs = this.deps.now();

    // Both heads: the non-resource rows, and the RESOURCE tier — a share
    // link deleted legacy-side is a live bearer token until this revokes
    // it, and `findResourceGrantRows` already fences on live rows, so no
    // already-revoked row can be re-revoked. A row legacy still HAS but the
    // migration chose not to express (`retainedGrantIds`) is not stale —
    // revoking it would delete a legacy row through the compat head, the
    // one change the migration promises not to make.
    const staleGrants = [
      ...heads.grantRows
        .filter(
          (row) =>
            AuthzMigrationOwnershipMapper.includes(row.source) &&
            !row.revoked &&
            !expected.grantIds.has(row.id) &&
            !expected.retainedGrantIds.has(row.id),
        )
        .map((row) => row.id),
      ...heads.resourceRows
        .filter(
          (row) =>
            AuthzMigrationOwnershipMapper.includes(row.source) &&
            !expected.grantIds.has(row.grantId),
        )
        .map((row) => row.grantId),
    ].sort();
    await this.each({
      items: staleGrants,
      signal,
      send: (grantId) =>
        this.deps.ledger.revokeGrant({
          organizationId,
          // The pass's business time is in the key for the reason the repair
          // keys carry it: a legacy row deleted, restored under the same id,
          // then deleted again would otherwise collide with the first deny's
          // idempotency key and be swallowed, leaving a live head with no
          // legacy row behind it. A live head is the only sweep candidate, so
          // a re-appended deny costs at most one event while the fold lags.
          commandId: AuthzMigrationCommandMapper.contentId({
            kind: "deny:grant",
            id: grantId,
            content: { occurredAtMs },
          }),
          grantId,
          reason: "authz-engine reconciliation: legacy row no longer exists",
          actor: ACTOR,
          occurredAtMs,
        }),
    });

    const expectedRoleIds = new Set(expected.roles.map((role) => role.roleId));
    const staleRoles = heads.roleHeads
      // Every kind: the migration only runs before an organization
      // finalizes, and until then every role head — `system_api_key`
      // included — mirrors a legacy CustomRole row, so a head with no such
      // row is stale whatever its kind.
      .filter((head) => !expectedRoleIds.has(head.id))
      .map((head) => head.id)
      .sort();
    await this.each({
      items: staleRoles,
      signal,
      send: (roleId) =>
        this.deps.ledger.deleteRole({
          organizationId,
          commandId: AuthzMigrationCommandMapper.contentId({
            kind: "deny:role",
            id: roleId,
            content: { occurredAtMs },
          }),
          roleId,
          actor: ACTOR,
          occurredAtMs,
        }),
    });
  }

  /**
   * Drift repair, covering the in-place legacy mutations: a binding's role
   * reassignment (onto a BUILT-IN key) and any edit to a custom role. Both
   * are stated with today's business time — a restated fact cannot carry
   * them, because the head's upsert guard refuses an event that is not
   * strictly newer than the row, and an adopted fact's business time is
   * pinned to the legacy row's createdAt.
   *
   * The pass's `occurredAtMs` is part of every repair's command id: a
   * repair whose target oscillates back to a value it held before would
   * otherwise collide with the first repair's idempotency key and be
   * swallowed at the event store forever. A retried held pass re-appends
   * the repair instead, which is harmless — the change events are
   * state-setting and tie-tolerant.
   *
   * A reassignment onto a `custom:<id>` key is NOT repaired: the change
   * event clears `legacyRole` (the projection's escalation rule) while the
   * expected fact still carries it, so that repair could never converge —
   * the proof names the disagreement instead (see the module header).
   */
  private async repairDrift({
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
    const occurredAtMs = this.deps.now();

    const headById = new Map(heads.grantRows.map((row) => [row.id, row]));
    const rekeys = expected.nonResourceFacts.flatMap((fact) => {
      const head = headById.get(fact.grantId);
      if (!head || head.revoked) return [];
      if (fact.roleKey === null || head.roleKey === fact.roleKey) return [];
      if (fact.roleKey.startsWith("custom:")) return [];
      return [{ grantId: fact.grantId, from: head.roleKey, to: fact.roleKey }];
    });
    await this.each({
      items: rekeys,
      signal,
      send: (rekey) =>
        this.deps.ledger.changeGrantRole({
          organizationId,
          commandId: AuthzMigrationCommandMapper.contentId({
            kind: "rekey",
            id: rekey.grantId,
            content: { to: rekey.to, occurredAtMs },
          }),
          grantId: rekey.grantId,
          from: rekey.from,
          to: rekey.to,
          actor: ACTOR,
          occurredAtMs,
        }),
    });

    // A drifted role is restated WHOLE: `defineRole` at today's business
    // time wins the head's strictly-newer guard and carries every field —
    // name, description, permissions, kind — in one mechanism.
    const roleHeadById = new Map(
      heads.roleHeads.map((head) => [head.id, head]),
    );
    const redefines = expected.roles.flatMap((role) => {
      const head = roleHeadById.get(role.roleId);
      if (!head || !AuthzMigrationProofMapper.roleDrifted({ role, head }))
        return [];
      return [{ ...role, occurredAtMs }];
    });
    await this.each({
      items: redefines,
      signal,
      send: (role) =>
        this.deps.ledger.defineRole({
          organizationId,
          commandId: AuthzMigrationCommandMapper.contentId({
            kind: "redefine",
            id: role.roleId,
            content: role,
          }),
          role,
          actor: ACTOR,
        }),
    });
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
    const grants = AuthzMigrationProofMapper.checkGrantHeads({
      expected,
      heads,
    });
    const roles = AuthzMigrationProofMapper.checkRoleHeads({ expected, heads });
    const resources = AuthzMigrationProofMapper.checkResourceHeads({
      organizationId,
      expected,
      heads,
    });
    return {
      outstanding: [
        ...grants.outstanding,
        ...roles.outstanding,
        ...resources.outstanding,
      ].sort(),
      diffs: [...grants.diffs, ...roles.diffs, ...resources.diffs],
    };
  }

  /** Bounded fan-out, aborted between chunks — the runner will not
   *  interrupt an in-flight send, so the boundary is the chunk. */
  private async each<T>({
    items,
    signal,
    send,
  }: {
    items: readonly T[];
    signal: AbortSignal | undefined;
    send: (item: T) => Promise<void>;
  }): Promise<void> {
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

/**
 * A command id derived from the fact's identity AND its content. Identity
 * alone is not enough: the event store dedupes on the idempotency key, so a
 * legacy row edited between two passes would restate under the first pass's
 * key and be silently swallowed. Content in the key means the same fact
 * always dedupes and a changed one always appends.
 */
class AuthzMigrationCommandMapper {
  static contentId({
    kind,
    id,
    content,
  }: {
    kind: string;
    id: string;
    content: unknown;
  }): string {
    const digest = createHash("sha256")
      .update(JSON.stringify(content))
      .digest("hex")
      .slice(0, 16);
    return `authz-engine:${kind}:${id}:${digest}`;
  }
}

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

export class AuthzMigrationOwnershipMapper {
  static includes(source: string): boolean {
    return (MIGRATION_OWNED_SOURCES as readonly string[]).includes(source);
  }
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
class AuthzBindingCoverageMapper {
  static create({
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

export class AuthzExpectedFactsMapper {
  static assemble({
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
      .map((row) => this.legacyRoleToFact(row));
    const bindingFacts = inventory.bindingRows
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .flatMap((row) => {
        const fact = this.bindingToFact({ row });
        return fact ? [fact] : [];
      });
    // One coverage predicate for both suppression rules below: a user is
    // "already bound" identically whether the binding names them or a group
    // they belong to, and the two rules must never disagree about that.
    const covers = AuthzBindingCoverageMapper.create({
      groupMemberships: inventory.groupMemberships,
    });
    const teamFacts = this.teamMembershipFacts({
      organizationId,
      teamRows: inventory.teamRows,
      bindingRows: inventory.bindingRows,
      covers,
    });
    const organizationFacts = this.organizationLevelFacts({
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
      .map((credential) =>
        this.credentialToFact({ organizationId, credential }),
      );
    const shareLinks = inventory.shareLinkRows
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(
        (row): ExpectedShareLink => ({
          row,
          fact: this.shareLinkToFact({ organizationId, row }),
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
          .filter((row) => this.bindingPrincipal(row) === null)
          .map((row) => row.id),
      ),
    };
  }

  /**
   * A CustomRole as the ledger defines it, adopting the row's own id. The
   * stored permissions column is jsonb: anything that is not an array of
   * strings imports as the empty list, which grants nothing.
   */
  private static legacyRoleToFact(row: LegacyRoleRow): RoleFact {
    const fact: RoleFact = {
      roleId: row.id,
      name: row.name,
      permissions: this.permissionStrings(row.permissions),
      kind: row.kind === "system_api_key" ? "system_api_key" : "custom",
      occurredAtMs: row.createdAtMs,
    };
    if (row.description !== null) fact.description = row.description;
    return fact;
  }

  static permissionStrings(stored: unknown): string[] {
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
  private static bindingToFact({
    row,
  }: {
    row: LegacyBindingRow;
  }): GrantFact | null {
    const principal = this.bindingPrincipal(row);
    if (!principal) return null;
    const fact: GrantFact = {
      grantId: row.id,
      principal,
      roleKey:
        row.customRoleId === null
          ? roleKeyForTeamRole(row.role)
          : `custom:${row.customRoleId}`,
      scope: { type: row.scopeType, id: row.scopeId },
      source: "migration",
      occurredAtMs: row.createdAtMs,
    };
    if (row.customRoleId !== null) fact.legacyRole = row.role;
    return fact;
  }

  private static bindingPrincipal(
    row: LegacyBindingRow,
  ): LedgerPrincipal | null {
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
  private static teamMembershipFacts({
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
    const suppressed = ({
      userId,
      teamId,
    }: {
      userId: string;
      teamId: string;
    }) =>
      bindingRows.some((row) => {
        const inPlay =
          (row.scopeType === "ORGANIZATION" &&
            row.scopeId === organizationId) ||
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
  private static organizationLevelFacts({
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
  private static credentialToFact({
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
  private static shareLinkToFact({
    organizationId,
    row,
  }: {
    organizationId: string;
    row: ShareLinkFactRow;
  }): GrantFact {
    const resource: NonNullable<GrantFact["resource"]> = {
      kind: row.resourceType === "THREAD" ? "thread" : "trace",
      projectId: row.projectId,
      token: row.token,
      permission: SHARE_LINK_PERMISSION,
    };
    if (row.userId !== null) resource.createdByUserId = row.userId;
    if (row.expiresAtMs !== null) resource.expiresAtMs = row.expiresAtMs;
    if (row.maxViews !== null) resource.maxViews = row.maxViews;
    return {
      grantId: row.id,
      principal: shareVisibilityAudience({
        visibility: row.visibility,
        organizationId,
        projectId: row.projectId,
      }),
      roleKey: null,
      scope: { type: "RESOURCE", id: row.resourceId },
      resource,
      source: "migration",
      occurredAtMs: row.createdAtMs,
    };
  }
}

/** One named disagreement between a head and the legacy row it mirrors.
 *  Missing and extra rows are not diffs: they are `outstanding` — the fold
 *  has not caught up with what this pass stated or revoked. */
export type AuthzEngineDiff = {
  kind: "grant_revoked" | "grant_changed" | "role_changed" | "resource_changed";
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

export class AuthzMigrationProofMapper {
  static checkGrantHeads({
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
      diffs.push(...this.grantDiffs({ fact, head }));
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
            AuthzMigrationOwnershipMapper.includes(row.source) &&
            !expected.grantIds.has(row.id) &&
            !expected.retainedGrantIds.has(row.id),
        )
        .map((row) => row.id),
    );
    return { outstanding, diffs };
  }

  static checkRoleHeads({
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
      diffs.push(...this.roleDiffs({ role, head }));
    }
    for (const head of heads.roleHeads) {
      if (!expectedRoleIds.has(head.id)) {
        outstanding.push(head.id);
      }
    }
    return { outstanding, diffs };
  }

  static checkResourceHeads({
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
    const headById = new Map(
      heads.resourceRows.map((row) => [row.grantId, row]),
    );
    const expectedLinkIds = new Set(
      expected.shareLinks.map((link) => link.row.id),
    );
    for (const link of expected.shareLinks) {
      const head = headById.get(link.row.id);
      if (!head) {
        outstanding.push(link.row.id);
        continue;
      }
      const result = this.resourceDiffs({ organizationId, link, head });
      outstanding.push(...result.outstanding);
      diffs.push(...result.diffs);
    }
    for (const row of heads.resourceRows) {
      // Only rows the migration owns: a live-write row (a ledger-first share
      // whose compat write was stepped over) is not this migration's to hold
      // an organization on, and never its to revoke.
      if (
        AuthzMigrationOwnershipMapper.includes(row.source) &&
        !expectedLinkIds.has(row.grantId)
      ) {
        outstanding.push(row.grantId);
      }
    }
    return { outstanding, diffs };
  }

  static roleDrifted({
    role,
    head,
  }: {
    role: RoleFact;
    head: RoleHeadRow;
  }): boolean {
    return (
      head.name !== role.name ||
      (head.description ?? null) !== (role.description ?? null) ||
      AuthzExpectedFactsMapper.permissionStrings(head.permissions).join(",") !==
        role.permissions.join(",") ||
      (head.kind === "system_api_key" ? "system_api_key" : "custom") !==
        role.kind
    );
  }

  /** Field equality for one stated fact against its head row — against what
   *  the migration SAID, since that is what the head is supposed to hold. */
  private static grantDiffs({
    fact,
    head,
  }: {
    fact: GrantFact;
    head: GrantHeadRow;
  }): AuthzEngineDiff[] {
    const compared: Array<[string, string | null, string | null]> = [
      [
        "principalType",
        PRINCIPAL_TO_DB[fact.principal.type],
        head.principalType,
      ],
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

  private static roleDiffs({
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
        AuthzExpectedFactsMapper.permissionStrings(head.permissions).join(","),
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
   * The view budget cuts both ways and the two directions mean different
   * things. A head BEHIND the legacy count is convergence lag — views land
   * legacy-side between passes and the monotonic seed raises the usage row
   * next pass — so it is `outstanding`, not a disagreement; reporting it as
   * one made an actively-viewed link re-hold the organization forever. A
   * head AHEAD of the legacy count is a budget that grew back, which nothing
   * legitimate produces, so that is the named diff.
   *
   * Tokens are bearer credentials and the report is persisted and rendered
   * on the ops page, so a token disagreement reports fingerprints, never the
   * values.
   */
  private static resourceDiffs({
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
      [
        "token",
        this.tokenFingerprint(row.token),
        this.tokenFingerprint(head.token),
      ],
      [
        "kind",
        row.resourceType,
        (head.resourceKind ?? "").toUpperCase() || null,
      ],
      ["resourceId", row.resourceId, head.resourceId],
      ["projectId", row.projectId, head.projectId],
      ["principalType", PRINCIPAL_TO_DB[principal.type], head.principalType],
      ["principalId", principal.id, head.principalId],
      [
        "expiresAt",
        this.numberField(row.expiresAtMs),
        this.numberField(head.expiresAtMs),
      ],
      [
        "maxViews",
        this.numberField(row.maxViews),
        this.numberField(head.maxViews),
      ],
    ];
    if (head.viewCount > row.viewCount) {
      compared.push([
        "viewCount",
        this.numberField(row.viewCount),
        this.numberField(head.viewCount),
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

  private static tokenFingerprint(token: string | null): string | null {
    if (token === null) return null;
    return createHash("sha256").update(token).digest("hex").slice(0, 12);
  }

  private static numberField(value: number | null): string | null {
    return value === null ? null : String(value);
  }
}
