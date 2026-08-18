/**
 * The grants ledger's app-side writer (ADR-092 §13): the ONE storage engine
 * behind every grant mutation. Callers keep their own validation and error
 * surfaces; this module owns emission — every write is a command whose
 * ClickHouse append is waited on, the fold lands it in the two-headed
 * Postgres projection through the per-org queue, and revocation-class writes
 * additionally apply their deny effect synchronously (decision 7: the one
 * sanctioned direct projection write, shaped so it can only make deny true
 * early, never grant).
 *
 * Read-your-writes: attach- and role-shaped writes wait (bounded) for the
 * projection to land their rows before returning. The wait is an
 * observation, not inline processing — a fold that cannot run (Redis down)
 * makes the wait time out, the write is still durable, and the rows appear
 * when the fold drains (ADR-007's breaker doctrine). Revocations never need
 * the wait: enforcement already deleted the rows.
 *
 * PER-ORGANIZATION, NOT PER-DEPLOY (decision 4). Every verb asks the write
 * gate first: an organization whose genesis import has landed writes
 * through the ledger, everyone else still takes the imperative Prisma
 * write, and an operator's `rolled_back` flip returns an organization to
 * the imperative path with no deploy. The fork lives HERE and nowhere else
 * — every call site keeps calling the same verb and never learns which side
 * answered it. Rows written imperatively while on the legacy side are
 * adopted by the next genesis pass (it takes each legacy row's own id as
 * the fact's id), which is what makes flip → rollback → re-flip safe.
 *
 * The audit trail forks with the writes: a migrated organization gets its
 * rows from the insert-only subscriber (decision 17); an unmigrated one
 * writes the same-shaped `AuditLog` row itself, best-effort, since a failed
 * audit insert must not fail a grant write.
 *
 * Identity: a runtime fact's grant id is the caller-minted binding KSUID,
 * the id the REST surface already returns to customers (decision 23's
 * house pattern). Retries reuse the commandId so the same payload dedupes
 * at the event store. Content-derived ids (`deriveGrantId`) are the
 * import/migration tool's, where identity must survive re-runs with no
 * caller to remember a mint.
 */
import {
  type TeamUserRole as AuthzTeamUserRole,
  roleKeyForTeamRole,
} from "@langwatch/authz";
import {
  BindingMissingError,
  type BindingPrincipalWhere,
  bindingIdentityKey,
  DuplicateBindingError,
  type GrantRevocationSelector,
  type LedgerScopeType,
  type RoleBindingWrite,
} from "@langwatch/authz-server";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import type {
  AttachGrantsCommandData,
  ChangeGrantRoleCommandData,
  CompleteCutoverCommandData,
  DefineRolesCommandData,
  DeleteRoleCommandData,
  OffboardMemberCommandData,
  ProveMigrationParityCommandData,
  RecordMigrationTenantStateCommandData,
  RevokeGrantsCommandData,
  RollBackCutoverCommandData,
} from "~/server/event-sourcing/pipelines/authz-grants/schemas/commands";
import {
  AUTHZ_AUDIT_ACTION_PREFIX,
  AUTHZ_GRANTS_PIPELINE_NAME,
} from "~/server/event-sourcing/pipelines/authz-grants/schemas/constants";
import { prisma as appPrisma } from "../../db";
import { tryGetApp } from "../app";
import { bumpAuthzEpoch } from "./epoch";
import { isOrgOnLedgerWrites } from "./ledger-write-gate";
import { PrismaAuthzGrantsProjectionRepository } from "./repositories/authz-grants-projection.prisma.repository";

const logger = createLogger("langwatch:authz:ledger");

export type LedgerActor = { type: "user" | "system"; id: string | null };

/**
 * Which writer authored a runtime fact — the event's `source` field.
 *
 * `read-through-mint` is the compatibility path (decision 1: no legacy-key
 * sunset): a credential whose access predates the ledger states it the first
 * time it is used, rather than being asked to be re-issued.
 */
export type LedgerWriteSource =
  | "grants-service"
  | "scim"
  | "invite"
  | "read-through-mint";

type Sender<T> = { send: (data: T) => Promise<unknown> };

/** The memoized pipeline handle behind `authzGrantsCommands()`. */
let grantsLedgerHandle: Promise<{
  commands: AuthzGrantsCommandSenders;
}> | null = null;

export type AuthzGrantsCommandSenders = {
  attachGrants: Sender<AttachGrantsCommandData>;
  changeGrantRole: Sender<ChangeGrantRoleCommandData>;
  revokeGrants: Sender<RevokeGrantsCommandData>;
  defineRoles: Sender<DefineRolesCommandData>;
  deleteRole: Sender<DeleteRoleCommandData>;
  offboardMember: Sender<OffboardMemberCommandData>;
  proveMigrationParity: Sender<ProveMigrationParityCommandData>;
  completeCutover: Sender<CompleteCutoverCommandData>;
  rollBackCutover: Sender<RollBackCutoverCommandData>;
  recordMigrationTenantState: Sender<RecordMigrationTenantStateCommandData>;
};

/**
 * The grants ledger cannot take a write right now: the App handle never
 * appeared inside the wait, or its event-sourcing stack is off.
 *
 * Handled and NAMED rather than a bare Error because the caller can act on it
 * — retry, or the operator brings the stack back — and because a grant write
 * that cannot append must not read to the customer as a validation failure.
 * `fault: "platform"`: this is ours, never theirs, so it pages rather than
 * being logged as routine 4xx noise. The detail (which of the two reasons)
 * goes to the log line; the message stays customer-safe.
 */
export class AuthzLedgerUnavailableError extends HandledError {
  declare readonly code: "authz_ledger_unavailable";

  constructor() {
    super(
      "authz_ledger_unavailable",
      "Access changes are temporarily unavailable. Try again in a moment.",
      { httpStatus: 503, fault: "platform" },
    );
    this.name = "AuthzLedgerUnavailableError";
  }
}

/**
 * How long a send waits for the App handle before refusing.
 *
 * Short on purpose. The only caller that legitimately arrives before the
 * handle exists is a boot-time write racing App composition, which takes
 * hundreds of milliseconds; anything longer is a stack that is not coming, and
 * blocking a request thread on it turns one broken dependency into a queue of
 * held connections. Failing fast with a typed 503 is what lets the caller
 * retry — the write never half-happened.
 */
export const LEDGER_APP_HANDLE_WAIT_MS = 5_000;

/**
 * The `authz_grants` pipeline's senders, resolved lazily at send time (the
 * pipeline is being registered while callers' modules load). Boot-time
 * callers run DURING App composition (`tryGetApp()` is null for its first
 * moments), so a null App is briefly waited out rather than refused; an App
 * whose event-sourcing stack is disabled is refused immediately rather than
 * letting DisabledPipeline swallow the send.
 */
export async function authzGrantsCommands(options?: {
  waitMs?: number;
}): Promise<{
  commands: AuthzGrantsCommandSenders;
}> {
  // Memoized: every write, every `attachGrants` chunk, every parity proof and
  // every witnessed transition would otherwise re-run the wait. The promise is
  // cleared on failure so a send that arrived before the stack was up does not
  // poison every later one.
  grantsLedgerHandle ??= resolveAuthzGrantsCommands(options).catch((error) => {
    grantsLedgerHandle = null;
    throw error;
  });
  return grantsLedgerHandle;
}

async function resolveAuthzGrantsCommands(options?: {
  waitMs?: number;
}): Promise<{
  commands: AuthzGrantsCommandSenders;
}> {
  const waitMs = options?.waitMs ?? LEDGER_APP_HANDLE_WAIT_MS;
  const deadline = Date.now() + waitMs;
  let app = tryGetApp();
  while (!app && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    app = tryGetApp();
  }
  if (!app?.eventSourcing?.isEnabled) {
    logger.error(
      { waitMs, reason: app ? "event_sourcing_disabled" : "app_not_composed" },
      "the grants ledger cannot append: the event-sourcing stack is unavailable",
    );
    throw new AuthzLedgerUnavailableError();
  }
  return app.eventSourcing.getPipeline(
    AUTHZ_GRANTS_PIPELINE_NAME as never,
  ) as unknown as { commands: AuthzGrantsCommandSenders };
}

/** Decision 23: user-action paths mint a random command id; retries reuse it. */
export function newLedgerCommandId(): string {
  return generate("authzcmd").toString();
}

const CONVERGENCE_POLL_MS = 150;
const CONVERGENCE_TIMEOUT_MS = 8_000;

export type LedgerBindingAttach = Omit<RoleBindingWrite, "organizationId">;

/**
 * The one principal a write names, in the port's exactly-one shape. Call
 * sites carry three optional columns (the legacy row shape); the port carries
 * a union that makes "two principals on one row" unrepresentable, and this is
 * the single place the two meet.
 */
export function ledgerPrincipal({
  userId,
  groupId,
  apiKeyId,
}: {
  userId?: string | null;
  groupId?: string | null;
  apiKeyId?: string | null;
}): BindingPrincipalWhere {
  if (userId) return { userId };
  if (groupId) return { groupId };
  if (apiKeyId) return { apiKeyId };
  throw new Error("a binding write names no principal");
}

export type AttachOutcome = {
  /** Binding ids actually emitted (duplicates skipped when asked to). */
  attached: string[];
  /** Binding ids of pre-existing identical rows the write skipped. */
  duplicates: string[];
};

/**
 * The writer itself. Composed per call (`grantsLedgerWriter()`), holds no
 * state. Every verb bumps the org's authz epoch after its write lands
 * (decision 19: the epoch stays until contract; the projection cursor is
 * alongside, not instead).
 */
export class GrantsLedgerWriter {
  private readonly enforcement: PrismaAuthzGrantsProjectionRepository;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly deps: {
      commands?: () => Promise<{ commands: AuthzGrantsCommandSenders }>;
      now?: () => number;
      poll?: { intervalMs: number; timeoutMs: number };
      /**
       * The per-organization write fork (decision 4). Injectable so a test
       * can put an organization on either side without a state row; in
       * production it is the genesis-import gate next door.
       */
      onLedgerWrites?: (args: { organizationId: string }) => Promise<boolean>;
    } = {},
  ) {
    this.enforcement = new PrismaAuthzGrantsProjectionRepository(prisma);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private commands() {
    return (this.deps.commands ?? authzGrantsCommands)();
  }

  /** Whether THIS organization's grant writes go through the ledger yet. */
  private onLedger(organizationId: string): Promise<boolean> {
    return (this.deps.onLedgerWrites ?? isOrgOnLedgerWrites)({
      organizationId,
    });
  }

  /**
   * The audit row a migrated organization would have got from the subscriber,
   * written here because an unmigrated one has no event to subscribe to. Same
   * action vocabulary, same `metadata = the fact minus its actor`, same
   * actor-to-`userId` rule; only the id differs, because there is no event id
   * to derive one from, so the column's own default mints it.
   *
   * Best-effort on purpose: a write that succeeded must not be reported as
   * failed because its trail did not land.
   */
  private async recordLegacyAudit({
    organizationId,
    actor,
    verb,
    createdAt,
    facts,
  }: {
    organizationId: string;
    actor: LedgerActor;
    verb: string;
    createdAt: Date;
    facts: Record<string, unknown>[];
  }): Promise<void> {
    if (facts.length === 0) return;
    try {
      await this.prisma.auditLog.createMany({
        data: facts.map((metadata) => ({
          createdAt,
          userId: actor.type === "user" ? actor.id : null,
          organizationId,
          action: `${AUTHZ_AUDIT_ACTION_PREFIX}${verb}`,
          metadata: metadata as Prisma.InputJsonValue,
        })),
      });
    } catch (err) {
      logger.warn(
        { err, organizationId, action: `${AUTHZ_AUDIT_ACTION_PREFIX}${verb}` },
        "failed to record the audit row for a grant write on the pre-ledger path; the write itself landed",
      );
    }
  }

  /**
   * INSERT one or more binding facts. `onDuplicate: "reject"` names the
   * first identical row (the single-write surfaces' 409); `"skip"` filters
   * them out (the `createMany … skipDuplicates` surfaces' semantics —
   * re-asserting a row the principal already holds leaves exactly the state
   * the caller asked for).
   */
  async attachBindings({
    organizationId,
    bindings,
    actor,
    source = "grants-service",
    onDuplicate,
    commandId,
    occurredAtMs: occurredAtOverrideMs,
    awaitProjection = true,
  }: {
    organizationId: string;
    bindings: LedgerBindingAttach[];
    actor: LedgerActor;
    source?: LedgerWriteSource;
    onDuplicate: "reject" | "skip";
    /**
     * A caller-derived command id, for writes that are not a user action and
     * therefore have no retry to remember one (decision 23: migration-shaped
     * writers derive theirs from the source row). Two concurrent emissions of
     * the same derived fact then carry the same `<commandId>:<index>`
     * idempotency key and dedupe at the event store. Omitted, a random one is
     * minted, which is what a genuine repeat action wants.
     */
    commandId?: string;
    /**
     * The fact's business time. Backdating writers pass the source row's own
     * timestamp so the grant keeps the time it really started — and so a
     * content-derived grant id, whose KSUID timestamp IS this value, stays
     * stable across re-emissions. Defaults to now, which is true of every
     * fact born from a live action.
     */
    occurredAtMs?: number;
    /**
     * Whether to hold for the projection to land the rows. On by default:
     * a caller that just wrote usually reads next. A write that is not on
     * anybody's read path — the read-through mint, off the auth hot path —
     * turns it off, because the append is already durable and waiting would
     * only spend the request's time.
     */
    awaitProjection?: boolean;
  }): Promise<AttachOutcome> {
    if (bindings.length === 0) return { attached: [], duplicates: [] };

    const { fresh, duplicates } = await this.partitionByIdentity({
      organizationId,
      bindings,
      onDuplicate,
    });
    if (fresh.length === 0) return { attached: [], duplicates };

    const occurredAtMs = occurredAtOverrideMs ?? this.now();
    if (!(await this.onLedger(organizationId))) {
      return await this.attachBindingsImperatively({
        organizationId,
        fresh,
        duplicates,
        actor,
        source,
        onDuplicate,
        occurredAtMs,
      });
    }
    await (await this.commands()).commands.attachGrants.send({
      tenantId: organizationId,
      organizationId,
      commandId: commandId ?? newLedgerCommandId(),
      grants: fresh.map((binding) => ({
        grantId: binding.bindingId,
        principal: principalForWhere(binding.principal),
        roleKey: roleKeyFor(binding),
        scope: { type: binding.scopeType, id: binding.scopeId },
        source,
        actor,
        occurredAtMs,
      })),
    });

    const wanted = fresh.map((binding) => binding.bindingId);
    if (awaitProjection) {
      await this.awaitProjection({
        what: `attach of ${wanted.length} binding(s)`,
        organizationId,
        check: async () => {
          const present = await this.prisma.roleBinding.count({
            where: { organizationId, id: { in: wanted } },
          });
          return present === wanted.length;
        },
      });
    }
    await bumpAuthzEpoch({ organizationId });
    return { attached: wanted, duplicates };
  }

  /**
   * Split a batch into the bindings that are genuinely new and the ids of the
   * identical rows already present — the identity pre-check both sides of the
   * fork run, so an organization's outcome does not change when it migrates.
   * A repeat inside the same batch counts as a duplicate of itself.
   */
  private async partitionByIdentity({
    organizationId,
    bindings,
    onDuplicate,
  }: {
    organizationId: string;
    bindings: LedgerBindingAttach[];
    onDuplicate: "reject" | "skip";
  }): Promise<{ fresh: LedgerBindingAttach[]; duplicates: string[] }> {
    // ONE query for the whole batch, keyed by the identity tuples: a
    // `findFirst` per binding made a SCIM sync of 200 seats 200 round trips.
    // `OR` over the same tuple the per-binding lookup built, so the rows it
    // can match are identical — only the number of queries changed.
    const existingByIdentity = await this.findExistingByIdentity({
      organizationId,
      bindings,
    });

    const fresh: LedgerBindingAttach[] = [];
    const duplicates: string[] = [];
    const seen = new Set<string>();
    for (const binding of bindings) {
      const key = bindingIdentityKey(binding);
      // A repeat inside the same batch counts as a duplicate of itself, and
      // answers with the id the batch itself minted — the row is not in
      // storage yet, so there is none to name.
      const existingId = seen.has(key)
        ? binding.bindingId
        : existingByIdentity.get(key);
      if (existingId !== undefined) {
        if (onDuplicate === "reject") {
          throw new DuplicateBindingError();
        }
        duplicates.push(existingId);
        continue;
      }
      seen.add(key);
      fresh.push(binding);
    }
    return { fresh, duplicates };
  }

  /** The stored rows that already carry one of the batch's identities, keyed
   *  by the same identity string the partition compares on. */
  private async findExistingByIdentity({
    organizationId,
    bindings,
  }: {
    organizationId: string;
    bindings: LedgerBindingAttach[];
  }): Promise<Map<string, string>> {
    if (bindings.length === 0) return new Map();
    const rows = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        OR: bindings.map((binding) =>
          bindingIdentityWhere({ organizationId, binding }),
        ),
      },
      select: {
        id: true,
        userId: true,
        groupId: true,
        apiKeyId: true,
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    });
    const byIdentity = new Map<string, string>();
    for (const row of rows) {
      byIdentity.set(
        bindingIdentityKey({
          principal: principalWhereForRow(row),
          role: row.role,
          customRoleId: row.customRoleId,
          scopeType: row.scopeType,
          scopeId: row.scopeId,
        }),
        row.id,
      );
    }
    return byIdentity;
  }

  /**
   * The pre-ledger attach, for an organization the genesis import has not
   * reached: the rows are written directly (`insertBindingRows` below owns
   * the two duplicate semantics). The identity pre-check above ran on this
   * path too, so both sides answer the same `AttachOutcome`; the partial
   * unique indexes remain the backstop for the race the pre-check cannot
   * close.
   */
  private async attachBindingsImperatively({
    organizationId,
    fresh,
    duplicates,
    actor,
    source,
    onDuplicate,
    occurredAtMs,
  }: {
    organizationId: string;
    fresh: LedgerBindingAttach[];
    duplicates: string[];
    actor: LedgerActor;
    source: LedgerWriteSource;
    onDuplicate: "reject" | "skip";
    occurredAtMs: number;
  }): Promise<AttachOutcome> {
    const rows = fresh.map((binding) =>
      legacyBindingRow({ organizationId, binding }),
    );

    await this.insertBindingRows({ rows, onDuplicate });

    await this.recordLegacyAudit({
      organizationId,
      actor,
      verb: "attach",
      createdAt: new Date(occurredAtMs),
      facts: attachAuditFacts({ fresh, source }),
    });
    await bumpAuthzEpoch({ organizationId });
    return { attached: rows.map((row) => row.id), duplicates };
  }

  /**
   * The two INSERT semantics the call sites were built on: `reject` inserts
   * row by row so the first collision becomes the 409 the REST contract
   * froze, `skip` takes `createMany`'s own `skipDuplicates`.
   */
  private async insertBindingRows({
    rows,
    onDuplicate,
  }: {
    rows: ReturnType<typeof legacyBindingRow>[];
    onDuplicate: "reject" | "skip";
  }): Promise<void> {
    if (onDuplicate !== "reject") {
      await this.prisma.roleBinding.createMany({
        data: rows,
        skipDuplicates: true,
      });
      return;
    }
    for (const data of rows) {
      try {
        await this.prisma.roleBinding.create({ data });
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateBindingError();
        throw error;
      }
    }
  }

  /**
   * UPDATE the role one binding carries, keeping its identity. Missing rows
   * throw `BindingMissingError`; a sibling row already holding the target
   * role at the same scope throws `DuplicateBindingError` — the same two
   * knowable failures the imperative writer surfaced.
   */
  async changeBindingRole({
    organizationId,
    bindingId,
    role,
    customRoleId,
    actor,
  }: {
    organizationId: string;
    bindingId: string;
    role: RoleBindingWrite["role"];
    customRoleId: string | null;
    actor: LedgerActor;
  }): Promise<void> {
    const row = await this.prisma.roleBinding.findFirst({
      where: { id: bindingId, organizationId },
    });
    if (!row) throw new BindingMissingError();

    const to = roleKeyFor({ role, customRoleId });
    const from = roleKeyFor({
      role: row.role,
      customRoleId: row.customRoleId,
    });
    if (from === to) return;

    const sibling = await this.prisma.roleBinding.findFirst({
      where: {
        ...bindingIdentityWhere({
          organizationId,
          binding: {
            principal: principalWhereForRow(row),
            role,
            customRoleId,
            scopeType: row.scopeType,
            scopeId: row.scopeId,
          },
        }),
        id: { not: bindingId },
      },
      select: { id: true },
    });
    if (sibling) throw new DuplicateBindingError();

    if (!(await this.onLedger(organizationId))) {
      return await this.changeBindingRoleImperatively({
        organizationId,
        bindingId,
        role,
        customRoleId,
        from,
        to,
        actor,
      });
    }

    await (await this.commands()).commands.changeGrantRole.send({
      tenantId: organizationId,
      organizationId,
      commandId: newLedgerCommandId(),
      grantId: bindingId,
      from,
      to,
      actor,
      occurredAtMs: this.now(),
    });
    await this.awaitProjection({
      what: `role change on binding ${bindingId}`,
      organizationId,
      check: async () => {
        const updated = await this.prisma.roleBinding.findFirst({
          where: { id: bindingId, organizationId },
          select: { role: true, customRoleId: true },
        });
        return (
          updated != null &&
          roleKeyFor({
            role: updated.role,
            customRoleId: updated.customRoleId,
          }) === to
        );
      },
    });
    await bumpAuthzEpoch({ organizationId });
  }

  /**
   * The pre-ledger role change, unchanged from the imperative writer: the two
   * knowable database refusals keep their meaning, because neither the
   * pre-read nor the sibling check above can close either race.
   */
  private async changeBindingRoleImperatively({
    organizationId,
    bindingId,
    role,
    customRoleId,
    from,
    to,
    actor,
  }: {
    organizationId: string;
    bindingId: string;
    role: RoleBindingWrite["role"];
    customRoleId: string | null;
    from: string;
    to: string;
    actor: LedgerActor;
  }): Promise<void> {
    try {
      await this.prisma.roleBinding.update({
        where: { id: bindingId },
        data: { role, customRoleId },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateBindingError();
      if (isRecordNotFound(error)) throw new BindingMissingError();
      throw error;
    }
    await this.recordLegacyAudit({
      organizationId,
      actor,
      verb: "role_change",
      createdAt: new Date(this.now()),
      facts: [{ grantId: bindingId, from, to }],
    });
    await bumpAuthzEpoch({ organizationId });
  }

  /**
   * DELETE binding facts — revocation-class (decision 7): the deny effect is
   * applied synchronously on this path after the append, so it holds before
   * the call returns even with the queue stopped. Absent ids are no-ops.
   */
  async revokeBindings({
    organizationId,
    bindingIds,
    actor,
    reason,
    selector,
  }: {
    organizationId: string;
    bindingIds: string[];
    actor: LedgerActor;
    reason?: string;
    /**
     * The identity a revoke-by-filter named, carried onto the events so the
     * FOLD sweeps every grant matching it. `bindingIds` comes from the compat
     * projection, which lags the ledger by a fold: a grant appended moments
     * earlier is missing from that list, and an id-only revocation would leave
     * it standing forever. Synchronous enforcement still runs on the ids alone
     * — a row the projection cannot see is a row there is nothing to delete —
     * and the sweep closes the gap when the fold catches up.
     */
    selector?: GrantRevocationSelector;
  }): Promise<void> {
    if (bindingIds.length === 0 && selector === undefined) return;
    if (!(await this.onLedger(organizationId))) {
      // The pre-ledger revoke. An imperative delete IS instant enforcement —
      // decision 7's synchronous deny effect is what this path always was —
      // so there is no event and nothing to converge on.
      await this.prisma.roleBinding.deleteMany({
        where: { organizationId, id: { in: bindingIds } },
      });
      await this.recordLegacyAudit({
        organizationId,
        actor,
        verb: "revoke",
        createdAt: new Date(this.now()),
        facts: bindingIds.map((grantId) => ({
          grantId,
          ...(reason ? { reason } : {}),
        })),
      });
      await bumpAuthzEpoch({ organizationId });
      return;
    }
    await (await this.commands()).commands.revokeGrants.send({
      tenantId: organizationId,
      organizationId,
      commandId: newLedgerCommandId(),
      revocations: revocationEntries({ bindingIds, reason, selector }),
      actor,
      occurredAtMs: this.now(),
    });
    await this.enforcement.enforceGrantRevocation({
      organizationId,
      grantIds: bindingIds,
    });
    await bumpAuthzEpoch({ organizationId });
  }

  /**
   * Revoke every binding matching a filter; answers how many it revoked.
   *
   * SEAM, to be narrowed: `where` is a raw `Prisma.RoleBindingWhereInput`, so
   * a storage type is part of a port every call site now depends on, and the
   * filter cannot be carried onto the event except for the shapes
   * `revocationSelector` can read back (principal, optionally at one scope).
   * The replacement is a small closed vocabulary — the same union the
   * selector already speaks — which is a call-site change across four
   * repositories and belongs in its own commit rather than in a review fix.
   * Until then, the two guards below stand in for the type: every filter is
   * organization-scoped, and a filter naming no organization is refused
   * rather than quietly running fleet-wide.
   */
  async revokeBindingsWhere({
    organizationId,
    where,
    actor,
    reason,
  }: {
    organizationId: string;
    where: Prisma.RoleBindingWhereInput;
    actor: LedgerActor;
    reason?: string;
  }): Promise<number> {
    if (!organizationId) {
      throw new Error(
        "revokeBindingsWhere refused a filter with no organization: a grant revocation is always tenant-scoped",
      );
    }
    const rows = await this.prisma.roleBinding.findMany({
      // `organizationId` LAST, so a caller's filter can never widen the
      // tenancy the caller named.
      where: { ...where, organizationId },
      select: { id: true },
    });
    const selector = revocationSelector(where);
    await this.revokeBindings({
      organizationId,
      bindingIds: rows.map((row) => row.id),
      actor,
      ...(reason ? { reason } : {}),
      ...(selector ? { selector } : {}),
    });
    return rows.length;
  }

  /**
   * Record one member's offboarding: the fact carries every revoked grant id
   * the caller could see, and enforcement deletes those heads synchronously.
   * The id list is the AUDIT record, not the instruction — the fold sweeps
   * every grant the principal holds, so a grant appended between the caller's
   * query and this append (invisible to the lagging projection) cannot
   * survive the departure. Membership tables (OrganizationUser, TeamUser,
   * group memberships, invites) are not grant facts — their deletes stay with
   * the caller.
   */
  async offboardMember({
    organizationId,
    userId,
    revokedGrantIds,
    actor,
  }: {
    organizationId: string;
    userId: string;
    revokedGrantIds: string[];
    actor: LedgerActor;
  }): Promise<void> {
    if (!(await this.onLedger(organizationId))) {
      // The pre-ledger offboard: the member's grant rows go, and the
      // membership tables stay with the caller exactly as they do on the
      // ledger side.
      await this.prisma.roleBinding.deleteMany({
        where: { organizationId, id: { in: revokedGrantIds } },
      });
      await this.recordLegacyAudit({
        organizationId,
        actor,
        verb: "offboard",
        createdAt: new Date(this.now()),
        facts: [{ userId, revokedGrantIds }],
      });
      await bumpAuthzEpoch({ organizationId });
      return;
    }
    await (await this.commands()).commands.offboardMember.send({
      tenantId: organizationId,
      organizationId,
      commandId: newLedgerCommandId(),
      userId,
      revokedGrantIds,
      actor,
      occurredAtMs: this.now(),
    });
    await this.enforcement.enforceGrantRevocation({
      organizationId,
      grantIds: revokedGrantIds,
    });
    await bumpAuthzEpoch({ organizationId });
  }

  /**
   * Define (or redefine) one role. `role_defined` carries the whole fact, so
   * a rename and a permissions change are the same verb — the fold upserts.
   */
  async defineRole({
    organizationId,
    roleId,
    name,
    description,
    permissions,
    kind,
    actor,
  }: {
    organizationId: string;
    roleId: string;
    name: string;
    description?: string;
    permissions: string[];
    kind: "custom" | "system_api_key";
    actor: LedgerActor;
  }): Promise<void> {
    const occurredAtMs = this.now();
    if (!(await this.onLedger(organizationId))) {
      // The pre-ledger role write. `role_defined` collapsed the editor's
      // create and update into one verb; the upsert is that same collapse
      // against the table, keyed on the id the caller minted — organization
      // scoped on the update so a role can never be edited across tenants.
      // The name-uniqueness pre-checks live at the service layer and run on
      // both sides.
      await this.prisma.customRole.upsert({
        where: { id: roleId, organizationId },
        create: {
          id: roleId,
          organizationId,
          name,
          description: description ?? null,
          permissions,
          kind,
        },
        update: {
          name,
          description: description ?? null,
          permissions,
          kind,
        },
      });
      await this.recordLegacyAudit({
        organizationId,
        actor,
        verb: "role_defined",
        createdAt: new Date(occurredAtMs),
        facts: [
          {
            roleId,
            name,
            ...(description ? { description } : {}),
            permissions,
            kind,
          },
        ],
      });
      await bumpAuthzEpoch({ organizationId });
      return;
    }
    await (await this.commands()).commands.defineRoles.send({
      tenantId: organizationId,
      organizationId,
      commandId: newLedgerCommandId(),
      roles: [
        {
          roleId,
          name,
          ...(description ? { description } : {}),
          permissions,
          kind,
          occurredAtMs,
        },
      ],
      actor,
    });
    await this.awaitProjection({
      what: `definition of role ${roleId}`,
      organizationId,
      // The COMPAT head, like every other read-your-writes check here: that
      // is the table `deleteRole` polls, the table the resolver reads, and
      // the table every consumer of a freshly defined role reads. `Role` is
      // the future head, written by the same `store()` — polling it would
      // return before the row the caller is about to look for exists.
      check: async () => {
        const row = await this.prisma.customRole.findFirst({
          where: { id: roleId, organizationId },
          select: { name: true, permissions: true },
        });
        return (
          row != null &&
          row.name === name &&
          samePermissions(row.permissions, permissions)
        );
      },
    });
    await bumpAuthzEpoch({ organizationId });
  }

  /**
   * Delete one role definition. Bindings carrying the role are the caller's
   * to revoke first (`revokeBindingsWhere({ customRoleId })`) — revocation
   * enforcement makes the deny instant; the definition's disappearance
   * follows through the fold.
   */
  async deleteRole({
    organizationId,
    roleId,
    actor,
  }: {
    organizationId: string;
    roleId: string;
    actor: LedgerActor;
  }): Promise<void> {
    if (!(await this.onLedger(organizationId))) {
      // The pre-ledger role delete. `deleteMany` rather than `delete` keeps
      // the imperative writer's shape: a role already gone is not an error,
      // and the organization scoping is in the filter, not a later check.
      await this.prisma.customRole.deleteMany({
        where: { id: roleId, organizationId },
      });
      await this.recordLegacyAudit({
        organizationId,
        actor,
        verb: "role_deleted",
        createdAt: new Date(this.now()),
        facts: [{ roleId }],
      });
      await bumpAuthzEpoch({ organizationId });
      return;
    }
    await (await this.commands()).commands.deleteRole.send({
      tenantId: organizationId,
      organizationId,
      commandId: newLedgerCommandId(),
      roleId,
      actor,
      occurredAtMs: this.now(),
    });
    await this.awaitProjection({
      what: `deletion of role ${roleId}`,
      organizationId,
      check: async () => {
        const present = await this.prisma.customRole.count({
          where: { id: roleId, organizationId },
        });
        return present === 0;
      },
    });
    await bumpAuthzEpoch({ organizationId });
  }

  /**
   * Bounded read-your-writes: poll until the projection reflects the write.
   * Timing out is NOT a failure — the append landed and the fold will drain
   * (Redis-down doctrine); the caller's write is durable either way.
   */
  private async awaitProjection({
    what,
    organizationId,
    check,
  }: {
    what: string;
    organizationId: string;
    check: () => Promise<boolean>;
  }): Promise<void> {
    const poll = this.deps.poll ?? {
      intervalMs: CONVERGENCE_POLL_MS,
      timeoutMs: CONVERGENCE_TIMEOUT_MS,
    };
    const deadline = this.now() + poll.timeoutMs;
    for (;;) {
      if (await check()) return;
      if (this.now() >= deadline) {
        logger.warn(
          { organizationId, what },
          "grants projection did not land a write within the read-your-writes window; the append is durable and the fold will converge",
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, poll.intervalMs));
    }
  }
}

/** The writer over the app's Prisma singleton, composed per call. */
export function grantsLedgerWriter(): GrantsLedgerWriter {
  return new GrantsLedgerWriter(appPrisma);
}

/**
 * The revocation entries one revoke command carries.
 *
 * The selector rides the FIRST entry only: the fold's sweep is absolute, so
 * repeating it on every entry would remove exactly the same grants while
 * writing the identity into every audit row. When the lagging projection
 * listed no id at all, the selector IS the whole instruction and is the only
 * entry — which is why a filtered revoke that matched nothing still appends.
 */
function revocationEntries({
  bindingIds,
  reason,
  selector,
}: {
  bindingIds: string[];
  reason?: string;
  selector?: GrantRevocationSelector;
}): {
  grantId?: string;
  selector?: GrantRevocationSelector;
  reason?: string;
}[] {
  const withReason = reason ? { reason } : {};
  if (bindingIds.length === 0) {
    return selector ? [{ selector, ...withReason }] : [];
  }
  return bindingIds.map((grantId, index) => ({
    grantId,
    ...(index === 0 && selector ? { selector } : {}),
    ...withReason,
  }));
}

/** The three principal columns, as the selector's principal type. */
const SELECTOR_PRINCIPAL_TYPE = {
  userId: "user",
  groupId: "group",
  apiKeyId: "api_key",
} as const;

/** The filter keys a selector can express. Anything else — a customRoleId
 *  filter, a nested relation, a NOT — leaves the revocation on ids alone. */
const SELECTABLE_FILTER_KEYS: readonly string[] = [
  ...Object.keys(SELECTOR_PRINCIPAL_TYPE),
  "scopeType",
  "scopeId",
  "organizationId",
];

/**
 * The identity a `revokeBindingsWhere` filter names, when it names one the
 * event can carry: exactly one principal column, optionally narrowed to one
 * scope, every value a plain string.
 *
 * Returning undefined is the safe answer, not a failure: the revocation then
 * behaves exactly as it did before — the ids the projection could see — and
 * the only thing lost is the fold's healing for that filter shape.
 */
function revocationSelector(
  where: Prisma.RoleBindingWhereInput,
): GrantRevocationSelector | undefined {
  const keys = Object.keys(where).filter(
    (key) => where[key as keyof typeof where] !== undefined,
  );
  if (keys.some((key) => !SELECTABLE_FILTER_KEYS.includes(key))) {
    return undefined;
  }
  const principals = keys.filter((key) => key in SELECTOR_PRINCIPAL_TYPE);
  if (principals.length !== 1) return undefined;
  const column = principals[0] as keyof typeof SELECTOR_PRINCIPAL_TYPE;
  const id = where[column];
  if (typeof id !== "string") return undefined;

  const principal = { type: SELECTOR_PRINCIPAL_TYPE[column], id } as const;

  const { scopeType, scopeId } = where;
  if (scopeType === undefined && scopeId === undefined) return { principal };
  // A half-named scope (one column without the other) is not a scope, and
  // guessing which grants it meant is exactly the wrong kind of healing.
  if (typeof scopeId !== "string") return undefined;
  const scope = ledgerScopeType(scopeType);
  if (scope === undefined) return undefined;
  return { principal, scope: { type: scope, id: scopeId } };
}

/** The scope enum as the ledger spells it, or undefined for anything the
 *  selector cannot name (a Prisma filter object rather than a value). */
function ledgerScopeType(value: unknown): LedgerScopeType | undefined {
  return LEDGER_SCOPE_TYPES.find((candidate) => candidate === value);
}

const LEDGER_SCOPE_TYPES: readonly LedgerScopeType[] = [
  "ORGANIZATION",
  "TEAM",
  "PROJECT",
  "RESOURCE",
  "PLATFORM",
];

/** One binding fact as the legacy table's three optional principal columns. */
function legacyBindingRow({
  organizationId,
  binding,
}: {
  organizationId: string;
  binding: LedgerBindingAttach;
}) {
  return {
    id: binding.bindingId,
    organizationId,
    userId: binding.principal.userId ?? null,
    groupId: binding.principal.groupId ?? null,
    apiKeyId: binding.principal.apiKeyId ?? null,
    role: binding.role,
    customRoleId: binding.customRoleId,
    scopeType: binding.scopeType,
    scopeId: binding.scopeId,
  };
}

/** The `grant_attached` payloads the subscriber would have seen, minus actor. */
function attachAuditFacts({
  fresh,
  source,
}: {
  fresh: LedgerBindingAttach[];
  source: LedgerWriteSource;
}): Record<string, unknown>[] {
  if (!auditableSource(source)) return [];
  return fresh.map((binding) => ({
    grantId: binding.bindingId,
    principal: principalForWhere(binding.principal),
    roleKey: roleKeyFor(binding),
    scope: { type: binding.scopeType, id: binding.scopeId },
    source,
  }));
}

/**
 * Whether a stored permission payload is exactly the list just written. The
 * column is JSON, so anything that is not an array of the same strings in the
 * same order is a row the fold has not landed yet.
 */
function samePermissions(stored: unknown, wanted: string[]): boolean {
  return (
    Array.isArray(stored) &&
    stored.length === wanted.length &&
    wanted.every((permission, index) => stored[index] === permission)
  );
}

/** The partial unique indexes refusing an identical binding. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/** Prisma's "record to update not found". */
export function isRecordNotFound(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  );
}

/**
 * The subscriber's relevance guard, on the pre-ledger side (decision 17).
 * `genesis-import` and `backfill-b` never reach this writer at all, and the
 * read-through mint is gated off for an unmigrated organization, so in
 * practice nothing is filtered here — the rule is stated anyway so the two
 * audit paths cannot drift into disagreeing about what earns a row.
 */
function auditableSource(source: LedgerWriteSource): boolean {
  return source !== "read-through-mint";
}

function roleKeyFor({
  role,
  customRoleId,
}: {
  role: RoleBindingWrite["role"];
  customRoleId: string | null;
}): string {
  return customRoleId === null
    ? roleKeyForTeamRole(role as AuthzTeamUserRole)
    : `custom:${customRoleId}`;
}

function principalForWhere(principal: BindingPrincipalWhere): {
  type: "user" | "group" | "api_key";
  id: string;
} {
  if (principal.userId !== undefined) {
    return { type: "user", id: principal.userId };
  }
  if (principal.groupId !== undefined) {
    return { type: "group", id: principal.groupId };
  }
  return { type: "api_key", id: principal.apiKeyId };
}

function principalWhereForRow(row: {
  userId: string | null;
  groupId: string | null;
  apiKeyId: string | null;
}): BindingPrincipalWhere {
  if (row.userId !== null) return { userId: row.userId };
  if (row.groupId !== null) return { groupId: row.groupId };
  if (row.apiKeyId !== null) return { apiKeyId: row.apiKeyId };
  throw new Error("role binding row carries no principal");
}

/**
 * Identity as the DATABASE defines it — the partial unique indexes key a
 * built-in binding on its role and a custom one on its custom role id (see
 * `bindingKey` in the backfill migration; same two-key rule).
 */
function bindingIdentityWhere({
  organizationId,
  binding,
}: {
  organizationId: string;
  binding: Omit<LedgerBindingAttach, "bindingId">;
}): Prisma.RoleBindingWhereInput {
  return {
    organizationId,
    scopeType: binding.scopeType,
    scopeId: binding.scopeId,
    userId: binding.principal.userId ?? null,
    groupId: binding.principal.groupId ?? null,
    apiKeyId: binding.principal.apiKeyId ?? null,
    ...(binding.customRoleId === null
      ? { role: binding.role, customRoleId: null }
      : { customRoleId: binding.customRoleId }),
  };
}
