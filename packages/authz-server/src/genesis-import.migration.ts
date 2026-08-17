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
 * Three kinds of fact, emitted in that order, chunked, with deterministic
 * commandIds (decision 23) so a retried pass appends the same events and
 * the store dedupes them:
 *
 *   1. `genesis:roles:<org>:<i>`      every CustomRole, adopted by id.
 *   2. `genesis:grants:<org>:<i>`     every RoleBinding, adopted by id.
 *   3. `genesis:org-facts:<org>:<i>`  the facts the legacy schema INFERRED
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
 * The proof is the compat projection byte-equalling the original rows: every
 * binding row still there, id-equal and field-equal, and every CustomRole
 * matched by an id-equal `Role` head. One carve-out: a row with a
 * `customRoleId` is not compared on `role`, because the fold normalizes it
 * to CUSTOM and the partial unique indexes key custom rows on the custom
 * role id, never on the role column (PR 1's replay test pinned this). Drift
 * HOLDS the organization with the differences in its report; a clean sweep
 * finalizes it. No epoch bump and no `migration_parity_proved` fact — this
 * import changes no decision, and the proof fact belongs to the backfill and
 * the cutover machine.
 *
 * Spec: specs/rbac/in-place-authz-migration.feature.
 */
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

/** The actor on every fact this import authors: no human performed it. */
const GENESIS_ACTOR: GrantsLedgerActor = {
  type: "system",
  id: "system:genesis-import",
};

/** Entries per command: one command appends one event batch, and a
 *  five-figure organization should not ride in a single payload. */
const GENESIS_CHUNK = 500;

/** Reports stay bounded however far the projection has drifted. */
const MAX_REPORTED_DIFFS = 50;

const DEFAULT_POLL = { intervalMs: 500, timeoutMs: 120_000 };

/** One way the projection failed to reproduce a legacy row. */
export type GenesisDiff = {
  kind: "binding_missing" | "binding_changed" | "role_missing" | "role_changed";
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
  poll?: { intervalMs: number; timeoutMs: number };
};

export class GrantsGenesisImportMigration implements SystemMigration {
  readonly name = GRANTS_GENESIS_IMPORT_MIGRATION_NAME;

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

    await this.emit({
      organizationId,
      roles,
      bindingGrants,
      orgFacts,
      signal,
    });
    await this.awaitConvergence({
      organizationId,
      grantIds: [...bindingGrants, ...orgFacts].map((grant) => grant.grantId),
      roleIds: roles.map((role) => role.roleId),
      signal,
    });

    const diffs = await this.proveCompatEquality({
      organizationId,
      bindingRows,
      roleRows,
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
    for (const [index, chunk] of chunked(roles).entries()) {
      this.assertNotAborted(signal);
      await this.deps.ledger.defineRoles({
        organizationId,
        commandId: `genesis:roles:${organizationId}:${index}`,
        roles: chunk,
        actor: GENESIS_ACTOR,
      });
    }
    for (const [index, chunk] of chunked(bindingGrants).entries()) {
      this.assertNotAborted(signal);
      await this.deps.ledger.attachGrants({
        organizationId,
        commandId: `genesis:grants:${organizationId}:${index}`,
        grants: chunk,
      });
    }
    for (const [index, chunk] of chunked(orgFacts).entries()) {
      this.assertNotAborted(signal);
      await this.deps.ledger.attachGrants({
        organizationId,
        commandId: `genesis:org-facts:${organizationId}:${index}`,
        grants: chunk,
      });
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
    const poll = this.deps.poll ?? DEFAULT_POLL;
    const deadline = this.deps.now() + poll.timeoutMs;
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
          `grants projection did not land the genesis import for ${organizationId} within ${poll.timeoutMs}ms; tenant parked for retry`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, poll.intervalMs));
    }
  }

  /**
   * The proof: the compat projection byte-equals the rows we imported from.
   * Re-read rather than trust the first read — the import ran in between,
   * and what this asserts is that it changed nothing the legacy resolver
   * can see.
   */
  private async proveCompatEquality({
    organizationId,
    bindingRows,
    roleRows,
  }: {
    organizationId: string;
    bindingRows: LegacyBindingRow[];
    roleRows: LegacyRoleRow[];
  }): Promise<GenesisDiff[]> {
    const [currentBindings, roleHeads] = await Promise.all([
      this.deps.repository.findLegacyBindingRows({ organizationId }),
      this.deps.repository.findRoleHeads({ organizationId }),
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
    ? stored.filter((entry): entry is string => typeof entry === "string")
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
  // legacy admin fallback, which reads the membership row. That inference
  // becomes an explicit org-scoped grant; an admin who also holds bindings
  // is already represented by them.
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
      roleKey: "admin",
      scope,
      source: "genesis-import",
      occurredAtMs: member.createdAtMs,
      actor: GENESIS_ACTOR,
    });
  }
  return facts;
}

/**
 * Field equality for one binding row. `role` is deliberately absent for
 * custom rows: the fold normalizes a custom binding's role column to CUSTOM,
 * and the partial unique indexes key such a row on its custom role id, so
 * the column is not part of its identity (PR 1's replay proof pinned this).
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
    ...(original.customRoleId === null
      ? ([["role", original.role, current.role]] as Array<
          [string, string | null, string | null]
        >)
      : []),
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
