/**
 * ADR-092 §13, delivery plan PR 2 — the genesis import: every grant that
 * exists today becomes a ledger fact, so the whole grants state is
 * event-derived from the beginning of history and replayable from genesis.
 *
 * Adoption, not re-creation. Each emitted fact keeps the id the legacy row
 * already carries — a `RoleBinding`'s id becomes the grant id, a
 * `CustomRole`'s id becomes the role id — because that id is the upstream
 * identity the REST surface already returns to customers (decision 23's
 * house pattern) and the compat head then converges onto the very same
 * rows. Customer-visible binding ids never change; the import writes no new
 * legacy-visible row at all (the projection's compat write is UPDATE-ONLY
 * for this source — that is what keeps PR 2 dark).
 *
 * Three kinds of fact, emitted in that order, chunked, with idempotency keys
 * derived from each chunk's own content (decision 23; see
 * `contentCommandId`) so a retried pass appends the same events and the
 * store dedupes them — a positional key does NOT hold this property when the
 * upstream rows shift between passes, which is why the key is a hash of the
 * chunk's ids and not its index:
 *
 *   1. `genesis:roles:<org>:<hash>`      every CustomRole, adopted by id.
 *   2. `genesis:grants:<org>:<hash>`     every RoleBinding, adopted by id.
 *   3. `genesis:org-facts:<org>:<hash>`  the facts the legacy schema INFERRED
 *      rather than stored (decision 15): the org-member floor row
 *      (decision 11 — one per organization, `members-of(org)` as a
 *      principal) and, per decision 20, an org-scoped admin grant for every
 *      `OrganizationUser.role = ADMIN` with no binding anywhere — the live
 *      legacy-admin fallback path
 *      (specs/ai-gateway/rbac-legacy-admin-fallback.feature). Those two
 *      live in the `Grant` head only; neither has a legacy row to adopt,
 *      and minting one would be a visible change.
 *
 * Roles go first: a custom binding's roleKey names its role.
 *
 * Business time is each source row's own `createdAt` — for the derived
 * facts, the organization's and the membership row's — which is what makes
 * `deriveGrantId` stable across re-runs.
 *
 * A fourth step reconciles the DENY direction: a legacy row deleted while an
 * organization was off the engine has no event of its own (the legacy fork's
 * writes are imperative row-deletes), so every pass diffs the Grant/Role
 * heads this import owns against the rows it just read and emits a
 * compensating `grant_revoked` / `role_deleted` for anything the legacy side
 * no longer has (`reconcileRevocations`) — otherwise a
 * flip-rollback-imperative-revoke-reflip sequence leaves a zombie grant in
 * the head forever.
 *
 * The proof is the compat projection byte-equalling the original rows in
 * BOTH directions: every binding row still there, id-equal and field-equal,
 * every CustomRole matched by an id-equal `Role` head, AND neither head
 * holding a genesis-owned fact the legacy rows no longer name. No column is
 * carved out, `role` included: a custom row's emission carries the stored
 * value as `legacyRole`, so the compat upsert must reproduce it, and a
 * rewrite to CUSTOM is drift like any other. Drift HOLDS the organization
 * with the differences in its report; a clean sweep finalizes it. No epoch
 * bump and no `migration_parity_proved` fact — this import changes no
 * decision, and the proof fact belongs to the backfill and the cutover
 * machine.
 *
 * Spec: specs/rbac/in-place-authz-migration.feature.
 */
import { createHash } from "node:crypto";
import { roleKeyForTeamRole } from "@langwatch/authz";
import type {
  SystemMigration,
  TenantMigrationOutcome,
} from "@langwatch/system-migrations";
import type {
  AuthzGenesisRepository,
  LegacyBindingRow,
  LegacyRoleRow,
  OrganizationMemberFact,
  RoleHeadRow,
} from "./authz-migration.repository";
import {
  type ConvergencePoll,
  convergenceTimeoutMs,
  DEFAULT_CONVERGENCE_POLL,
} from "./convergence-poll";
import { GRANTS_GENESIS_IMPORT_MIGRATION_NAME } from "./genesis-import.name";
import { deriveGrantId } from "./ledger/grant-identity";
import type {
  GrantsLedgerActor,
  LedgerPrincipal,
  RoleFact,
} from "./ledger/grants-ledger.reducer";
import type {
  BackfillGrantEmission,
  GrantsLedgerEmitter,
} from "./team-user-backfill.migration";

/** The system actor id on every fact this import authors: no human
 *  performed it. Exported so consumers outside this migration (the audit
 *  trail subscriber, which must recognise the genesis import's role facts
 *  by their actor) share this one literal instead of each pinning their
 *  own copy. */
export const GENESIS_ACTOR_ID = "system:genesis-import" as const;

const GENESIS_ACTOR: GrantsLedgerActor = {
  type: "system",
  id: GENESIS_ACTOR_ID,
};

/** Entries per command: one command appends one event batch, and a
 *  five-figure organization should not ride in a single payload. */
const GENESIS_CHUNK = 500;

/** Reports stay bounded however far the projection has drifted. */
const MAX_REPORTED_DIFFS = 50;

/** One way the projection failed to reproduce a legacy row - the ALLOW
 *  direction (`binding_missing`, `binding_changed`, `role_missing`,
 *  `role_changed`) - or a way it holds a fact the legacy side no longer
 *  does - the DENY direction (`binding_extra`, `role_extra`). The deny
 *  kinds surface only when the reconciliation sweep already tried to
 *  revoke the fact and it is still there on re-read: a real fold lag or a
 *  parked convergence, not a first-time miss. */
export type GenesisDiff = {
  kind:
    | "binding_missing"
    | "binding_changed"
    | "binding_extra"
    | "role_missing"
    | "role_changed"
    | "role_extra";
  id: string;
  field?: string;
  expected?: string | null;
  actual?: string | null;
};

export type GenesisImportDeps = {
  repository: AuthzGenesisRepository;
  ledger: GrantsLedgerEmitter;
  now: () => number;
  /** How long to wait for the projection to land the import before parking. */
  poll?: ConvergencePoll;
};

export class GrantsGenesisImportMigration implements SystemMigration {
  readonly name = GRANTS_GENESIS_IMPORT_MIGRATION_NAME;
  readonly title = "Grants ledger import";
  readonly description =
    "Copies every existing grant into the authorization ledger, which " +
    "becomes the system of record for grant changes. Permission checks " +
    "still answer from the legacy path.";
  // Dark: the import states facts without changing who decides, so no typed
  // confirmation stands in the way.
  readonly requiresOperatorConfirmation = false;
  // Dark by construction - the import states facts and proves them against
  // the rows it started from without changing who decides - so self-hosted
  // runs it automatically, as it has since it shipped.
  readonly runsAutomaticallyOnSelfHosted = true;

  constructor(private readonly deps: GenesisImportDeps) {}

  async migrateTenant({
    tenantId,
    signal,
  }: {
    tenantId: string;
    signal?: AbortSignal;
  }): Promise<TenantMigrationOutcome> {
    const organizationId = tenantId;
    const [roleRows, bindingRows, members, organizationCreatedAtMs] =
      await Promise.all([
        this.deps.repository.findLegacyRoleRows({ organizationId }),
        this.deps.repository.findLegacyBindingRows({ organizationId }),
        this.deps.repository.findOrganizationMembers({ organizationId }),
        this.deps.repository.findOrganizationCreatedAtMs({ organizationId }),
      ]);

    const roles = roleRows
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(legacyRoleToFact);
    const bindingGrants = bindingRows
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .flatMap((row) => {
        const emission = legacyBindingToEmission({ organizationId, row });
        return emission ? [emission] : [];
      });
    const orgFacts = organizationFacts({
      organizationId,
      members,
      bindingRows,
      organizationCreatedAtMs,
    });
    // What THIS pass says the Grant/Role heads should hold, from the
    // legacy rows just read. Anything the import previously authored that
    // is no longer in these sets has lost its legacy row - see
    // `reconcileRevocations`.
    const expectedGrantIds = new Set(
      [...bindingGrants, ...orgFacts].map((grant) => grant.grantId),
    );
    const expectedRoleIds = new Set(roleRows.map((row) => row.id));

    await this.emit({
      organizationId,
      roles,
      bindingGrants,
      orgFacts,
      signal,
    });
    await this.awaitConvergence({
      organizationId,
      grantIds: [...expectedGrantIds],
      roleIds: roles.map((role) => role.roleId),
      signal,
    });
    await this.reconcileRevocations({
      organizationId,
      expectedGrantIds,
      expectedRoleIds,
      signal,
    });

    const diffs = await this.proveCompatEquality({
      organizationId,
      bindingRows,
      roleRows,
      expectedGrantIds,
      expectedRoleIds,
    });
    const counts = {
      bindings: bindingGrants.length,
      roles: roles.length,
      orgFacts: orgFacts.length,
    };
    if (diffs.length > 0) {
      return {
        status: "migrated",
        report: {
          kind: "genesis_drift",
          ...counts,
          totalDiffs: diffs.length,
          diffs: diffs.slice(0, MAX_REPORTED_DIFFS),
        },
      };
    }
    return { status: "finalized", report: { kind: "genesis_clean", ...counts } };
  }

  /** Roles before grants: a custom binding's roleKey names its role. */
  private async emit({
    organizationId,
    roles,
    bindingGrants,
    orgFacts,
    signal,
  }: {
    organizationId: string;
    roles: RoleFact[];
    bindingGrants: BackfillGrantEmission[];
    orgFacts: BackfillGrantEmission[];
    signal?: AbortSignal;
  }): Promise<void> {
    for (const chunk of chunked(roles)) {
      this.assertNotAborted(signal);
      await this.deps.ledger.defineRoles({
        organizationId,
        commandId: contentCommandId({
          kind: "roles",
          organizationId,
          ids: chunk.map((role) => role.roleId),
        }),
        roles: chunk,
        actor: GENESIS_ACTOR,
      });
    }
    for (const chunk of chunked(bindingGrants)) {
      this.assertNotAborted(signal);
      await this.deps.ledger.attachGrants({
        organizationId,
        commandId: contentCommandId({
          kind: "grants",
          organizationId,
          ids: chunk.map((grant) => grant.grantId),
        }),
        grants: chunk,
      });
    }
    for (const chunk of chunked(orgFacts)) {
      this.assertNotAborted(signal);
      await this.deps.ledger.attachGrants({
        organizationId,
        commandId: contentCommandId({
          kind: "org-facts",
          organizationId,
          ids: chunk.map((grant) => grant.grantId),
        }),
        grants: chunk,
      });
    }
  }

  /**
   * The deny-direction half of the import: every head fact this migration
   * previously authored (`source: "genesis-import"`) whose legacy row is no
   * longer among the ones this pass just read gets a compensating
   * revocation - a legacy-side imperative delete has no event of its own,
   * so this sweep is the only thing that ever tells the ledger. Custom
   * roles get the same treatment against the Role head; `system_api_key`
   * roles are never legacy-sourced and are left alone.
   *
   * Runs after `awaitConvergence` so the just-emitted attaches have already
   * landed - reading the head before that would misread work in flight as
   * drift and revoke facts this very pass just asked for.
   */
  private async reconcileRevocations({
    organizationId,
    expectedGrantIds,
    expectedRoleIds,
    signal,
  }: {
    organizationId: string;
    expectedGrantIds: Set<string>;
    expectedRoleIds: Set<string>;
    signal?: AbortSignal;
  }): Promise<void> {
    const [genesisGrantIds, roleHeads] = await Promise.all([
      this.deps.repository.findGenesisOwnedGrantHeadIds({ organizationId }),
      this.deps.repository.findRoleHeads({ organizationId }),
    ]);
    const staleGrantIds = genesisGrantIds
      .filter((id) => !expectedGrantIds.has(id))
      .sort();
    const staleRoleIds = roleHeads
      .filter((head) => head.kind === "custom" && !expectedRoleIds.has(head.id))
      .map((head) => head.id)
      .sort();
    if (staleGrantIds.length === 0 && staleRoleIds.length === 0) return;

    const occurredAtMs = this.deps.now();
    for (const chunk of chunked(staleGrantIds)) {
      this.assertNotAborted(signal);
      await this.deps.ledger.revokeGrants({
        organizationId,
        commandId: contentCommandId({
          kind: "deny-grants",
          organizationId,
          ids: chunk,
        }),
        revocations: chunk.map((grantId) => ({
          grantId,
          reason: "genesis reconciliation: legacy row no longer exists",
        })),
        actor: GENESIS_ACTOR,
        occurredAtMs,
      });
    }
    for (const roleId of staleRoleIds) {
      this.assertNotAborted(signal);
      await this.deps.ledger.deleteRole({
        organizationId,
        commandId: `genesis:deny:role:${organizationId}:${roleId}`,
        roleId,
        actor: GENESIS_ACTOR,
        occurredAtMs,
      });
    }
    await this.awaitRevocationConvergence({
      organizationId,
      staleGrantIds,
      staleRoleIds,
      signal,
    });
  }

  /**
   * Block until the head no longer carries the facts just revoked - the
   * deny-direction twin of `awaitConvergence`, waiting for absence rather
   * than presence. Timing out throws: the tenant parks, and the proof would
   * otherwise report the still-landing revocation as fresh drift.
   */
  private async awaitRevocationConvergence({
    organizationId,
    staleGrantIds,
    staleRoleIds,
    signal,
  }: {
    organizationId: string;
    staleGrantIds: string[];
    staleRoleIds: string[];
    signal?: AbortSignal;
  }): Promise<void> {
    if (staleGrantIds.length === 0 && staleRoleIds.length === 0) return;
    const poll = this.deps.poll ?? DEFAULT_CONVERGENCE_POLL;
    const timeoutMs = convergenceTimeoutMs({
      poll,
      factCount: staleGrantIds.length + staleRoleIds.length,
    });
    const deadline = this.deps.now() + timeoutMs;
    for (;;) {
      this.assertNotAborted(signal);
      const [genesisGrantIds, roleHeads] = await Promise.all([
        this.deps.repository.findGenesisOwnedGrantHeadIds({ organizationId }),
        this.deps.repository.findRoleHeads({ organizationId }),
      ]);
      const grants = new Set(genesisGrantIds);
      const roles = new Set(roleHeads.map((head) => head.id));
      if (
        staleGrantIds.every((id) => !grants.has(id)) &&
        staleRoleIds.every((id) => !roles.has(id))
      ) {
        return;
      }
      if (this.deps.now() >= deadline) {
        throw new Error(
          `grants projection did not clear ${staleGrantIds.length + staleRoleIds.length} stale genesis fact(s) for ${organizationId} within ${timeoutMs}ms; tenant parked for retry`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, poll.intervalMs));
    }
  }

  /**
   * Block until every emitted fact is in the heads. The proof reads the
   * compat rows the fold writes, so sweeping early would report drift for
   * work that is merely in flight. Timing out throws: the tenant parks, and
   * the next pass waits again against events that are already durable.
   */
  private async awaitConvergence({
    organizationId,
    grantIds,
    roleIds,
    signal,
  }: {
    organizationId: string;
    grantIds: string[];
    roleIds: string[];
    signal?: AbortSignal;
  }): Promise<void> {
    if (grantIds.length === 0 && roleIds.length === 0) return;
    const poll = this.deps.poll ?? DEFAULT_CONVERGENCE_POLL;
    const timeoutMs = convergenceTimeoutMs({
      poll,
      factCount: grantIds.length + roleIds.length,
    });
    const deadline = this.deps.now() + timeoutMs;
    for (;;) {
      this.assertNotAborted(signal);
      const [presentGrantIds, roleHeads] = await Promise.all([
        this.deps.repository.findGrantHeadIds({ organizationId }),
        this.deps.repository.findRoleHeads({ organizationId }),
      ]);
      const grants = new Set(presentGrantIds);
      const roles = new Set(roleHeads.map((head) => head.id));
      if (
        grantIds.every((id) => grants.has(id)) &&
        roleIds.every((id) => roles.has(id))
      ) {
        return;
      }
      if (this.deps.now() >= deadline) {
        throw new Error(
          `grants projection did not land the genesis import for ${organizationId} within ${timeoutMs}ms; tenant parked for retry`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, poll.intervalMs));
    }
  }

  /**
   * The proof: the compat projection byte-equals the rows we imported from
   * (the ALLOW direction) AND the heads hold nothing beyond them (the DENY
   * direction - decision from the deny-direction review: a revoked legacy
   * row must not leave a zombie fact behind). Re-read rather than trust the
   * first read — the import ran in between, and what this asserts is that
   * it changed nothing the legacy resolver can see and left nothing extra
   * for the ledger to answer with instead.
   */
  private async proveCompatEquality({
    organizationId,
    bindingRows,
    roleRows,
    expectedGrantIds,
    expectedRoleIds,
  }: {
    organizationId: string;
    bindingRows: LegacyBindingRow[];
    roleRows: LegacyRoleRow[];
    expectedGrantIds: Set<string>;
    expectedRoleIds: Set<string>;
  }): Promise<GenesisDiff[]> {
    const [currentBindings, roleHeads, genesisGrantIds] = await Promise.all([
      this.deps.repository.findLegacyBindingRows({ organizationId }),
      this.deps.repository.findRoleHeads({ organizationId }),
      this.deps.repository.findGenesisOwnedGrantHeadIds({ organizationId }),
    ]);
    const byId = new Map(currentBindings.map((row) => [row.id, row]));
    const headsById = new Map(roleHeads.map((head) => [head.id, head]));

    const diffs: GenesisDiff[] = [
      ...bindingRows.flatMap((row) =>
        bindingDiffs({ original: row, current: byId.get(row.id) }),
      ),
      ...roleRows.flatMap((row) =>
        roleDiffs({ original: row, head: headsById.get(row.id) }),
      ),
      ...genesisGrantIds
        .filter((id) => !expectedGrantIds.has(id))
        .map((id): GenesisDiff => ({ kind: "binding_extra", id })),
      ...roleHeads
        .filter((head) => head.kind === "custom" && !expectedRoleIds.has(head.id))
        .map((head): GenesisDiff => ({ kind: "role_extra", id: head.id })),
    ];
    return diffs;
  }

  private assertNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error(
        "genesis import aborted before completing; tenant parked for retry",
      );
    }
  }
}

function chunked<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += GENESIS_CHUNK) {
    chunks.push(items.slice(i, i + GENESIS_CHUNK));
  }
  return chunks;
}

/**
 * A chunk's idempotency key, derived from the identities it carries rather
 * than from its position in the list (decision 23: ids are functions of
 * event content). The event store dedupes on the idempotencyKey ALONE
 * (`platform/app/src/server/event-sourcing/stores/eventStoreUtils.ts`), so a
 * positional key (`genesis:grants:<org>:3`) is only safe while every pass
 * sorts and chunks identically - the moment a legacy row is deleted and
 * another created between two passes, chunk 3's membership shifts and its
 * positional key collides with whatever the FIRST pass already wrote there,
 * silently dropping the new fact on every retry. A hash of the chunk's own
 * (sorted) ids never collides across differing content and always repeats
 * for identical content, which is what idempotency actually requires.
 */
function contentCommandId({
  kind,
  organizationId,
  ids,
}: {
  kind: string;
  organizationId: string;
  ids: string[];
}): string {
  const digest = createHash("sha256")
    .update(ids.slice().sort().join(""))
    .digest("hex")
    .slice(0, 16);
  return `genesis:${kind}:${organizationId}:${digest}`;
}

/**
 * A CustomRole as the ledger will define it, adopting the row's own id. The
 * stored permissions column is jsonb: anything that is not an array of
 * strings imports as the empty list, which grants nothing (decision 2 —
 * measured in production: zero such rows).
 */
function legacyRoleToFact(row: LegacyRoleRow): RoleFact {
  return {
    roleId: row.id,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    permissions: permissionStrings(row.permissions),
    kind: roleKind(row.kind),
    occurredAtMs: row.createdAtMs,
  };
}

function permissionStrings(stored: unknown): string[] {
  return Array.isArray(stored)
    ? stored.filter(
        // The empty string is not a permission: it names nothing, grants
        // nothing at decide time, and the wire boundary refuses it — so it
        // is dropped here rather than carried into the fact (decision 2
        // measured zero such rows in production). NOTE: `roleDiffs` compares
        // normalized against normalized, so a dropped entry never shows up
        // as drift — the proof checks the head against the emitted fact,
        // not against the raw column.
        (entry): entry is string => typeof entry === "string" && entry !== "",
      )
    : [];
}

function roleKind(stored: string): RoleFact["kind"] {
  return stored === "system_api_key" ? "system_api_key" : "custom";
}

/**
 * A RoleBinding as the ledger will attach it. The grant id IS the row id:
 * the legacy id is the fact's upstream identity, so the compat head
 * converges onto this very row and the id customers already hold survives
 * the whole migration. A row naming no principal cannot be expressed as a
 * grant; it is left exactly as it is (the proof still requires it to be
 * there, unchanged).
 */
function legacyBindingToEmission({
  organizationId,
  row,
}: {
  organizationId: string;
  row: LegacyBindingRow;
}): BackfillGrantEmission | null {
  const principal = bindingPrincipal(row);
  if (!principal) return null;
  return {
    grantId: row.id,
    principal,
    roleKey:
      row.customRoleId === null
        ? roleKeyForTeamRole(row.role)
        : `custom:${row.customRoleId}`,
    // A custom key erases which legacy role column value the row carried, so
    // the row's `role` travels as `legacyRole` — exactly as the stage-B
    // backfill does — or the fold's compat upsert rewrites the adopted row's
    // `role` to CUSTOM while the legacy resolver is still authoritative.
    ...(row.customRoleId === null ? {} : { legacyRole: row.role }),
    scope: { type: row.scopeType, id: row.scopeId },
    source: "genesis-import",
    occurredAtMs: row.createdAtMs,
    actor: GENESIS_ACTOR,
  };
}

function bindingPrincipal(row: LegacyBindingRow): LedgerPrincipal | null {
  if (row.userId !== null) return { type: "user", id: row.userId };
  if (row.groupId !== null) return { type: "group", id: row.groupId };
  if (row.apiKeyId !== null) return { type: "api_key", id: row.apiKeyId };
  return null;
}

/**
 * The facts the legacy schema inferred instead of storing. Both are
 * `Grant`-head-only: the floor row's principal is a collective the compat
 * shape cannot express at all, and the admin fallback's would map onto a
 * legacy-visible row the import must never author.
 */
function organizationFacts({
  organizationId,
  members,
  bindingRows,
  organizationCreatedAtMs,
}: {
  organizationId: string;
  members: OrganizationMemberFact[];
  bindingRows: LegacyBindingRow[];
  organizationCreatedAtMs: number | null;
}): BackfillGrantEmission[] {
  const scope = { type: "ORGANIZATION" as const, id: organizationId };
  const facts: BackfillGrantEmission[] = [];

  // Business time is the organization's own createdAt, so the floor row's
  // id is stable across re-runs. An organization that vanished between the
  // tenant listing and this read has no membership left to floor either.
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
      source: "genesis-import",
      occurredAtMs: organizationCreatedAtMs,
      actor: GENESIS_ACTOR,
    });
  }

  // Decision 20: an ADMIN with no binding ANYWHERE is served today by the
  // legacy admin fallback. That inference becomes a stored org-scoped fact;
  // an admin who also holds bindings is already represented by them.
  //
  // `legacy-admin`, NOT `admin`, and the difference is load-bearing: the
  // collector translates `admin` into a live ORGANIZATION-scope binding, and
  // the legacy heads have no counterpart row (this fact is Grant-head-only
  // by design) — so an `admin` key made the engine grant the full admin bag
  // where the legacy resolver grants the fallback's much narrower one, and
  // the cutover parity proof rightly refused every organization holding such
  // an admin. An untranslatable key is how this family stays dormant (the
  // same mechanism as `lite-member`): the fact is stored with its own
  // business time, today's collector skips it, and contract gives it the
  // bag the fallback actually grants when the fallback retires.
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
      source: "genesis-import",
      occurredAtMs: member.createdAtMs,
      actor: GENESIS_ACTOR,
    });
  }
  return facts;
}

/**
 * Field equality for one binding row, every column included. `role` used to
 * be carved out for custom rows on the grounds that the fold normalizes it
 * to CUSTOM — but the emission now carries the row's role as `legacyRole`
 * and the compat upsert reproduces it, so a changed role column is drift
 * like any other, and the carve-out would have hidden exactly the rewrite
 * it existed to excuse.
 */
function bindingDiffs({
  original,
  current,
}: {
  original: LegacyBindingRow;
  current: LegacyBindingRow | undefined;
}): GenesisDiff[] {
  if (!current) {
    return [{ kind: "binding_missing", id: original.id }];
  }
  const compared: Array<[string, string | null, string | null]> = [
    ["userId", original.userId, current.userId],
    ["groupId", original.groupId, current.groupId],
    ["apiKeyId", original.apiKeyId, current.apiKeyId],
    ["customRoleId", original.customRoleId, current.customRoleId],
    ["scopeType", original.scopeType, current.scopeType],
    ["scopeId", original.scopeId, current.scopeId],
    ["role", original.role, current.role],
  ];
  return compared.flatMap(([field, expected, actual]) =>
    expected === actual
      ? []
      : [
          {
            kind: "binding_changed" as const,
            id: original.id,
            field,
            expected,
            actual,
          },
        ],
  );
}

/** Field equality for one role, against the values the import emitted -
 *  the normalized permissions and kind, not the raw column, since that is
 *  what the fact says and what the head is supposed to hold. */
function roleDiffs({
  original,
  head,
}: {
  original: LegacyRoleRow;
  head: RoleHeadRow | undefined;
}): GenesisDiff[] {
  if (!head) {
    return [{ kind: "role_missing", id: original.id }];
  }
  const compared: Array<[string, string | null, string | null]> = [
    ["name", original.name, head.name],
    ["description", original.description, head.description],
    [
      "permissions",
      permissionStrings(original.permissions).join(","),
      permissionStrings(head.permissions).join(","),
    ],
    ["kind", roleKind(original.kind), roleKind(head.kind)],
  ];
  return compared.flatMap(([field, expected, actual]) =>
    expected === actual
      ? []
      : [
          {
            kind: "role_changed" as const,
            id: original.id,
            field,
            expected,
            actual,
          },
        ],
  );
}
