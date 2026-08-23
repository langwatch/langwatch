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
 * Three disagreements are named rather than repaired, deliberately — each
 * holds the organization with a diff an operator reads, and all of them fail
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
 * - A role head the fold has BURIED, whose legacy CustomRole row came back
 *   under the same id, reports `role_deleted` each pass: the projection has
 *   no un-delete, so nothing a restatement could carry would raise it.
 *
 * Deletion is also why the role head read returns tombstones and says so
 * (`RoleHeadRow.deleted`) rather than fencing them out. A role's name stays
 * taken after a delete, so its row stays for good; a read that dropped it
 * would make a buried head indistinguishable from one the fold has not
 * written yet, and the check would count a permanent tombstone as
 * `outstanding` on every pass — holding the organization on a condition no
 * later pass can clear, while the sweep re-sent that role's delete for as
 * long as the migration ran. One API key deleted between two passes was
 * enough to do it.
 *
 * @see specs/migration/authz-grants-rollout.feature
 * @see dev/docs/adr/110-grant-aggregates-are-grants.md
 */
import { createHash } from "node:crypto";
import type {
  ExternalMemberFact,
  GrantFact,
  GrantHeadRow,
  GrantsLedgerActor,
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
import type {
  SystemMigration,
  TenantMigrationOutcome,
} from "@langwatch/system-migrations";
import {
  type AuthzEngineDiff,
  checkGrantHeads,
  checkResourceHeads,
  checkRoleHeads,
  grantDrifted,
  type HeadState,
  roleDrifted,
  shareLinkDrifted,
} from "./authz-engine.check";
import {
  assembleFacts,
  type ExpectedFacts,
  isMigrationOwned,
} from "./authz-engine.facts";
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
  findGroupMemberships(args: {
    organizationId: string;
  }): Promise<Array<{ userId: string; groupId: string }>>;

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
  // RELEASED FOR SELF-HOSTED. Cloud soaked it first, per organization, by
  // enrollment. Flipping this IS the self-hosted release act — there is no
  // enrollment off cloud, so from the release that carries this line every
  // self-hosted installation migrates every organization it has,
  // automatically, at worker boot.
  //
  // It stays true. This is the prerequisite for removing the legacy
  // authorization path altogether: that removal cannot be safe until every
  // installation that might upgrade into it has already had a release that
  // runs this migration, and this is that release.
  //
  // The first pass after an upgrade states an organization's whole fact set,
  // because its projection heads start empty — unavoidable, and the only
  // time it happens. Every later pass states only what the heads do not
  // already carry (#7429), so this does not repeat at each boot.
  readonly runsAutomaticallyOnSelfHosted = true;

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

    // The budget handover, and it runs BEFORE the read below on purpose. It
    // rides every pass, monotonically upward: legacy keeps counting views
    // while the organization is held, and the proof compares the two counts
    // exactly, so re-seeding is what lets the count heal.
    //
    // This is not a fact and not an event — it is a direct write to the
    // budget table, which the pass can therefore observe in the very read it
    // is about to take. Seeding AFTER that read meant the check compared a
    // PRE-seed count against legacy, so a link viewed at any point between
    // one pass's seed and the next pass's read counted `outstanding` all over
    // again — and an organization whose links are viewed at least once per
    // pass interval could never finalize, however many passes it was given.
    // Reading after the write costs nothing and leaves no window: the pass
    // sees the budget it just handed over instead of waiting a pass for it.
    await this.deps.store.seedResourceGrantUsage({
      organizationId,
      seeds: expected.shareLinks.map((link) => ({
        grantId: link.row.id,
        projectId: link.row.projectId,
        viewCount: link.row.viewCount,
      })),
    });

    // The projection, read ONCE per pass (the spec's own words) — before
    // anything is STATED, so nothing here waits on a fold. Reconcile and the
    // check both walk this read: what this pass states is invisible to it by
    // construction, lands as `outstanding`, and the NEXT pass sees it folded
    // and finalizes. Holding a first pass to finalize a later one is the
    // design, not a shortcut.
    const heads = await this.readHeads(organizationId);

    await this.state({ organizationId, expected, heads, signal });
    await this.reconcileStale({ organizationId, expected, heads, signal });
    await this.repairDrift({ organizationId, expected, heads, signal });

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
  /**
   * State every fact the heads do not ALREADY carry identically.
   *
   * Restating a fact the head already matches is a no-op — the command id is
   * content-derived, so the event store swallows it — but that dedupe happens
   * downstream of the queue, which has already paid to enqueue, dispatch and
   * fold-check it. A grant is its own aggregate since ADR-101, so a held
   * organization re-drives one group per grant on every pass, and a pass runs
   * on every worker boot. The organization that made this necessary restaged
   * ~900k commands per pass, indefinitely, to converge on nothing.
   *
   * The filter is the check's own predicate, not a second opinion: a fact
   * skipped here is exactly a fact `check` counts as neither `outstanding`
   * nor a diff, so the pass's report is unchanged by the skipping. Anything
   * the heads lack, hold revoked, or disagree with is still stated, so the
   * first pass over an organization stages everything as before and drift
   * repair is untouched. A projection that is behind under-reports the
   * heads, which restates a fact needlessly — the pre-existing cost, and
   * still idempotent.
   */
  private async state({
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
    const roleHeadById = new Map(
      heads.roleHeads.map((head) => [head.id, head]),
    );
    const grantHeadById = new Map(heads.grantRows.map((row) => [row.id, row]));
    const resourceHeadById = new Map(
      heads.resourceRows.map((row) => [row.grantId, row]),
    );
    await this.each({
      items: expected.roles.filter((role) => {
        const head = roleHeadById.get(role.roleId);
        if (head === undefined) return true;
        // A buried head is the one place this filter is not the check's
        // predicate: the check names `role_deleted` and this states nothing,
        // because nothing it could state would land. `role.upsert` leaves
        // `deletedAt` alone by design, so the row would stay buried however
        // many times the fact were restated — and the delete already moved
        // the row's business time past the fact's own.
        if (head.deleted) return false;
        return roleDrifted({ role, head });
      }),
      signal,
      send: (role) =>
        this.deps.ledger.defineRole({
          organizationId,
          commandId: contentCommandId({
            kind: "role",
            id: role.roleId,
            content: role,
          }),
          role,
          actor: ACTOR,
        }),
    });
    const nonResourceGrants = [
      ...expected.bindingFacts,
      ...expected.teamFacts,
      ...expected.organizationFacts,
      ...expected.credentialFacts,
    ].filter((fact) => {
      const head = grantHeadById.get(fact.grantId);
      if (head === undefined) return true;
      // A revoked head is not agreement: the fact says the grant is live, so
      // it must be restated to bring the head back.
      return head.revoked || grantDrifted({ fact, head });
    });
    // Share links are checked against the RESOURCE heads, keyed by the link's
    // own id, so their filter cannot share the grant-head map above.
    const shareLinkGrants = expected.shareLinks
      .filter((link) => {
        const head = resourceHeadById.get(link.row.id);
        if (head === undefined) return true;
        return shareLinkDrifted({ organizationId, link, head });
      })
      .map((link) => link.fact);
    const grants = [...nonResourceGrants, ...shareLinkGrants];
    await this.each({
      items: grants,
      signal,
      send: (fact) =>
        this.deps.ledger.attachGrant({
          organizationId,
          commandId: contentCommandId({
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
            isMigrationOwned(row.source) &&
            !row.revoked &&
            !expected.grantIds.has(row.id) &&
            !expected.retainedGrantIds.has(row.id),
        )
        .map((row) => row.id),
      ...heads.resourceRows
        .filter(
          (row) =>
            isMigrationOwned(row.source) && !expected.grantIds.has(row.grantId),
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
          commandId: contentCommandId({
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
      //
      // A head already deleted is not a candidate, for the reason a revoked
      // grant is not one: the deny has landed. Its tombstone stays in the
      // head read forever, so re-sending the delete would append one event
      // per pass, for every pass there will ever be, to bury a row that is
      // already buried.
      .filter((head) => !head.deleted && !expectedRoleIds.has(head.id))
      .map((head) => head.id)
      .sort();
    await this.each({
      items: staleRoles,
      signal,
      send: (roleId) =>
        this.deps.ledger.deleteRole({
          organizationId,
          commandId: contentCommandId({
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
          commandId: contentCommandId({
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
      if (!head || head.deleted || !roleDrifted({ role, head })) return [];
      return [{ ...role, occurredAtMs }];
    });
    await this.each({
      items: redefines,
      signal,
      send: (role) =>
        this.deps.ledger.defineRole({
          organizationId,
          commandId: contentCommandId({
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
    const grants = checkGrantHeads({ expected, heads });
    const roles = checkRoleHeads({ expected, heads });
    const resources = checkResourceHeads({ organizationId, expected, heads });
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
function contentCommandId({
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
