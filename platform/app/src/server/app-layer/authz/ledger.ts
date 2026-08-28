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
 * the legacy path with no deploy. The fork lives HERE and nowhere else
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
import type { LedgerActor } from "@langwatch/actor";
import {
  type TeamUserRole as AuthzTeamUserRole,
  roleKeyForTeamRole,
} from "@langwatch/authz";
import {
  BindingMissingError,
  type BindingPrincipalWhere,
  DuplicateBindingError,
  type GrantEventSource,
  type LedgerScopeType,
  type RoleBindingWrite,
} from "@langwatch/authz-server";
// The migration subpath, not the root: grant identity touches `node:crypto`,
// and the package root is browser-evaluable by construction (the client
// bundle reaches it through the shadow fork). See the header of
// `@langwatch/authz-server/migration`.
import { bindingIdentityKey } from "@langwatch/authz-server/migration";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import type {
  AttachGrantCommandData,
  ChangeGrantRoleCommandData,
  ChangeRolePermissionsCommandData,
  DefineRoleCommandData,
  DeleteRoleCommandData,
  RevokeGrantCommandData,
} from "~/server/event-sourcing/pipelines/authz-grants/schemas/commands";
import {
  AUTHZ_AUDIT_ACTION_PREFIX,
  AUTHZ_GRANT_PIPELINE_NAME,
  type AuthzAuditVerb,
} from "~/server/event-sourcing/pipelines/authz-grants/schemas/constants";
import { NON_AUDITABLE_SOURCES } from "~/server/event-sourcing/pipelines/authz-grants/subscribers/authzAuditTrail.subscriber";
import { prisma as appPrisma } from "../../db";
import { RoleDuplicateNameError } from "../../role/errors/role-duplicate-name.error";
import { tryGetApp } from "../app";
import { organizationOnAuthzEngine } from "./engine-gate";
import { bumpAuthzEpoch } from "./epoch";
import { PrismaAuthzRevocationRepository } from "./repositories/authz-revocation.prisma.repository";
import { liveGrants } from "./repositories/live-rows";

const logger = createLogger("langwatch:authz:ledger");

type Sender<T> = { send: (data: T) => Promise<unknown> };

/** The memoized pipeline handle behind `authzGrantsCommands()`. */
let grantsLedgerHandle: Promise<{
  commands: AuthzGrantsCommandSenders;
}> | null = null;

/**
 * One command per entity (ADR-110): a batch would straddle aggregates, so a
 * caller with many grants sends many commands. They are independent and
 * apply concurrently, which is the point.
 */
export type AuthzGrantsCommandSenders = {
  attachGrant: Sender<AttachGrantCommandData>;
  changeGrantRole: Sender<ChangeGrantRoleCommandData>;
  revokeGrant: Sender<RevokeGrantCommandData>;
  defineRole: Sender<DefineRoleCommandData>;
  changeRolePermissions: Sender<ChangeRolePermissionsCommandData>;
  deleteRole: Sender<DeleteRoleCommandData>;
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
  //
  // Because the handle is shared, `options.waitMs` only takes effect for the
  // FIRST caller that creates the pending promise; every other caller racing
  // in while it is still pending gets that first caller's wait, not its own —
  // a later caller passing a shorter or longer `waitMs` is silently ignored
  // until the handle resolves (or fails) and a fresh resolution begins.
  grantsLedgerHandle ??= resolveAuthzGrantsCommands(options).catch((error) => {
    grantsLedgerHandle = null;
    throw error;
  });
  return grantsLedgerHandle;
}

/**
 * The memoized handle, dropped — for tests. A successful resolve memoizes
 * for the process lifetime by design (see above), which under `isolate:
 * false` can leak across test FILES sharing a worker, not just across tests
 * in one file: a test that resolves successfully poisons every later test's
 * `tryGetApp` mock with its own stale return value unless this runs first.
 */
export function resetAuthzGrantsCommandsForTests(): void {
  grantsLedgerHandle = null;
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
    AUTHZ_GRANT_PIPELINE_NAME as never,
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
 * The audience a resource fact names. `ShareVisibility`'s three values in
 * the ledger's own vocabulary — PUBLIC is "anyone" (id null, because there
 * is nobody to name), and the other two name the organization or project
 * whose members the link is for. A union rather than the general principal
 * shape, so a resource mint cannot accidentally state a user or a key.
 */
export type LedgerResourcePrincipal =
  | { type: "anyone"; id: null }
  | { type: "organization"; id: string }
  | { type: "project"; id: string };

/**
 * A resource fact's own terms, minus the `projectId` the verb takes
 * separately (it is also the compat head's tenancy, so the writer needs it
 * in its own right rather than buried in the terms).
 */
export type LedgerResourceTerms = {
  token: string;
  permission: string;
  kind: "trace" | "thread";
  expiresAtMs?: number;
  maxViews?: number;
  createdByUserId?: string;
};

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
  /**
   * Only the one sanctioned direct projection write (decision 7) — typed to
   * exactly that member so the writer cannot quietly grow a dependency on
   * the projection store's fold-side surface.
   */
  private readonly enforcement: Pick<
    PrismaAuthzRevocationRepository,
    "enforceGrantRevocation"
  >;

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
    this.enforcement = new PrismaAuthzRevocationRepository(prisma);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private commands() {
    return (this.deps.commands ?? authzGrantsCommands)();
  }

  /** Whether THIS organization's grant writes go through the ledger yet. */
  private onLedger(organizationId: string): Promise<boolean> {
    if (this.deps.onLedgerWrites) {
      return this.deps.onLedgerWrites({ organizationId });
    }
    return organizationOnAuthzEngine({ prisma: appPrisma, organizationId });
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
    verb: AuthzAuditVerb;
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
    /**
     * Which surface authored the fact — the provenance the actor cannot
     * state. `read-through-mint` is the compatibility path (decision 1: no
     * legacy-key sunset): a credential whose access predates the ledger
     * states it the first time it is used, rather than being asked to be
     * re-issued. Defaults to the grants service, which is what a hand-made
     * grant is.
     */
    source?: GrantEventSource;
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
    // One command per grant, and a command id derived from the batch's own
    // so a retry of the same attach dedupes per grant at the event store.
    const batchId = commandId ?? newLedgerCommandId();
    const senders = (await this.commands()).commands;
    await Promise.all(
      fresh.map((binding) =>
        senders.attachGrant.send({
          tenantId: organizationId,
          organizationId,
          commandId: `${batchId}:${binding.bindingId}`,
          grant: {
            grantId: binding.bindingId,
            principal: principalForWhere(binding.principal),
            roleKey: roleKeyFor(binding),
            scope: { type: binding.scopeType, id: binding.scopeId },
            source,
            actor,
            occurredAtMs,
          },
        }),
      ),
    );

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
    source: GrantEventSource;
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
   * INSERT one resource fact — a share link, as the ledger states it
   * (ADR-057's possession model intact, delivery-plan decision 22).
   *
   * Resource facts differ from binding facts in three ways, and all three
   * are visible in the shape here: they carry no role (their single
   * permission rides in the terms), their principal is an AUDIENCE rather
   * than an identity (anyone / an organization / a project), and their
   * compat head is `ShareLink` rather than `RoleBinding`. So the
   * read-your-writes wait watches the share row: the caller mints the id,
   * sends the fact, and then returns the row the fold wrote — which is the
   * row the customer's token already resolves to, because the id is shared.
   *
   * Timing out is not a failure here either (the append is durable); it
   * means the caller's read-back will come up empty and it is the caller's
   * business what to say about that.
   *
   * No write-gate ask, on purpose: the only caller is the share
   * repository's per-organization fork, which fires solely for a CUT-OVER
   * organization — and cutover requires the genesis import finalized, a
   * strictly stronger condition than the write gate's migrated-or-finalized.
   * An organization that is not on ledger writes never reaches this verb.
   */
  async attachResourceGrant({
    organizationId,
    grantId,
    projectId,
    resource,
    principal,
    scopeId,
    actor,
    commandId,
  }: {
    organizationId: string;
    /** The compat `ShareLink` row's id: minted by the caller, adopted here. */
    grantId: string;
    /** Where the shared resource lives — the compat head's tenancy column. */
    projectId: string;
    resource: LedgerResourceTerms;
    principal: LedgerResourcePrincipal;
    /** The shared resource's id, and nothing else — the RESOURCE scope. */
    scopeId: string;
    actor: LedgerActor;
    commandId?: string;
  }): Promise<void> {
    await (await this.commands()).commands.attachGrant.send({
      tenantId: organizationId,
      organizationId,
      commandId: commandId ?? newLedgerCommandId(),
      grant: {
        grantId,
        principal,
        roleKey: null,
        scope: { type: "RESOURCE", id: scopeId },
        resource: { ...resource, projectId },
        source: "grants-service",
        actor,
        occurredAtMs: this.now(),
      },
    });
    await this.awaitProjection({
      what: `attach of resource grant ${grantId}`,
      organizationId,
      check: async () => {
        const row = await this.prisma.shareLink.findFirst({
          where: { id: grantId, projectId },
          select: { id: true },
        });
        return row !== null;
      },
    });
    await bumpAuthzEpoch({ organizationId });
  }

  /**
   * DELETE resource facts. This is the ledger half of `revokeBindings` under
   * the name the resource tier calls it by — revocation is keyed on grant
   * ids and knows nothing about tiers, so the command, the synchronous
   * enforcement (decision 7) and the epoch bump are literally the same ones.
   * The synchronous enforcement marks the authoritative `Grant` row; the
   * compat `ShareLink` head is deleted by the caller
   * (`share.ledger.repository`, before it returns), not by this enforcement,
   * so a revoked link stops resolving on both heads without the fold running.
   *
   * NO `onLedger` gate, like `attachResourceGrant` and for a stronger
   * reason: the caller (`share.ledger.repository`) has already routed here
   * on an UNCACHED cutover read, and the write gate is a different, cached
   * answer — a stale or failed `false` from it would send a cut-over
   * organization's revocation to the legacy branch, which deletes only
   * `RoleBinding` rows: no fact appended, the `Grant` head keeps the grant,
   * and the fold re-projects the "revoked" link. Revocation must never come
   * undone, so it goes straight to the append; on an organization that
   * turns out to be on legacy the fact folds as a no-op and the enforcement
   * delete is the same delete the legacy path wanted.
   */
  async revokeResourceGrants({
    organizationId,
    grantIds,
    actor,
    reason,
  }: {
    organizationId: string;
    grantIds: string[];
    actor: LedgerActor;
    reason?: string;
  }): Promise<void> {
    if (grantIds.length === 0) return;
    await this.appendGrantRevocation({
      organizationId,
      bindingIds: grantIds,
      actor,
      ...(reason ? { reason } : {}),
    });
  }

  /** The ledger revocation itself: append, enforce synchronously, bump. */
  private async appendGrantRevocation({
    organizationId,
    bindingIds,
    actor,
    reason,
  }: {
    organizationId: string;
    bindingIds: string[];
    actor: LedgerActor;
    reason?: string;
  }): Promise<void> {
    // A revoke names its grant id: a selector cannot address an aggregate,
    // so resolving "every grant this principal holds" into ids is the
    // caller's job now, and the deny below is what makes that safe.
    const revokedAtMs = this.now();
    const batchId = newLedgerCommandId();
    const senders = (await this.commands()).commands;
    await Promise.all(
      bindingIds.map((grantId) =>
        senders.revokeGrant.send({
          tenantId: organizationId,
          organizationId,
          commandId: `${batchId}:${grantId}`,
          grantId,
          ...(reason ? { reason } : {}),
          actor,
          occurredAtMs: revokedAtMs,
        }),
      ),
    );
    await this.enforcement.enforceGrantRevocation({
      organizationId,
      grantIds: bindingIds,
      reason: "revocation",
      // The same instant and reason the events above carry, so the row the
      // deny marks is byte-identical to what the queued write would state —
      // the queue's `revokedAt: null` guard makes this mark the durable one.
      revokedAt: new Date(revokedAtMs),
      revokedReason: reason ?? null,
    });
    await bumpAuthzEpoch({ organizationId });
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
    await this.changeBindingRoleOnLedger({
      organizationId,
      row,
      bindingId,
      role,
      customRoleId,
      from,
      to,
      actor,
    });
  }

  /**
   * The ledger-side role change. A compat row can exist with no fact behind
   * it in the fold's head: it was written imperatively during the write
   * gate's negative-cache window (an organization the gate briefly, wrongly,
   * read as legacy — see `engine-gate.ts`) or during the genesis
   * snapshot -> flip gap, and `finalized` genesis passes never revisit it.
   * Sending `grant_role_changed` for such an id targets a grantId the
   * reducer has never seen; it no-ops silently there
   * (`state.grants[grantId]` undefined), `awaitProjection` times out with
   * only a warn, and the caller is told success while nothing changed. Adopt
   * the row instead, exactly as genesis adopts a legacy row: an attach fact
   * for this id, carrying the NEW role, both creates the head entry and
   * lands the requested change in one step.
   */
  private async changeBindingRoleOnLedger({
    organizationId,
    row,
    bindingId,
    role,
    customRoleId,
    from,
    to,
    actor,
  }: {
    organizationId: string;
    row: {
      id: string;
      userId: string | null;
      groupId: string | null;
      apiKeyId: string | null;
      scopeType: RoleBindingWrite["scopeType"];
      scopeId: string;
    };
    bindingId: string;
    role: RoleBindingWrite["role"];
    customRoleId: string | null;
    from: string;
    to: string;
    actor: LedgerActor;
  }): Promise<void> {
    const known = await liveGrants(this.prisma).findFirst({
      where: { id: bindingId, organizationId },
      select: { id: true },
    });
    if (!known) {
      await this.adoptStrandedRoleChange({
        organizationId,
        row,
        role,
        customRoleId,
        actor,
      });
      await bumpAuthzEpoch({ organizationId });
      return;
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
   * Adopt a stranded compat row into the fold as part of changing its role:
   * an attach fact for the row's own id, carrying the role the caller asked
   * for, so the reducer's overwrite-by-id semantics for `grant_attached`
   * both create the head entry and land the change (mirrors
   * `genesis-import.migration.ts`'s adoption of legacy rows by id).
   */
  private async adoptStrandedRoleChange({
    organizationId,
    row,
    role,
    customRoleId,
    actor,
  }: {
    organizationId: string;
    row: {
      id: string;
      userId: string | null;
      groupId: string | null;
      apiKeyId: string | null;
      scopeType: RoleBindingWrite["scopeType"];
      scopeId: string;
    };
    role: RoleBindingWrite["role"];
    customRoleId: string | null;
    actor: LedgerActor;
  }): Promise<void> {
    const occurredAtMs = this.now();
    await (await this.commands()).commands.attachGrant.send({
      tenantId: organizationId,
      organizationId,
      commandId: newLedgerCommandId(),
      grant: {
        grantId: row.id,
        principal: principalForWhere(principalWhereForRow(row)),
        roleKey: roleKeyFor({ role, customRoleId }),
        scope: { type: row.scopeType, id: row.scopeId },
        source: "grants-service",
        actor,
        occurredAtMs,
      },
    });
    await this.awaitProjection({
      what: `adoption of stranded binding ${row.id} at role ${roleKeyFor({ role, customRoleId })}`,
      organizationId,
      check: async () => {
        const updated = await this.prisma.roleBinding.findFirst({
          where: { id: row.id, organizationId },
          select: { role: true, customRoleId: true },
        });
        return (
          updated != null &&
          roleKeyFor({
            role: updated.role,
            customRoleId: updated.customRoleId,
          }) === roleKeyFor({ role, customRoleId })
        );
      },
    });
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
      // `updateMany`, not `update` by bare id: the pre-read above already
      // ran under `organizationId`, and the write should stay scoped to the
      // same tenant rather than trust the id alone. `updateMany` never
      // throws Prisma's not-found (P2025) the way a singular `update` does,
      // so the same race — the row gone between the pre-read and here — is
      // caught by the zero-match count instead.
      const updated = await this.prisma.roleBinding.updateMany({
        where: { id: bindingId, organizationId },
        data: { role, customRoleId },
      });
      if (updated.count === 0) throw new BindingMissingError();
    } catch (error) {
      if (error instanceof BindingMissingError) throw error;
      if (isUniqueViolation(error)) throw new DuplicateBindingError();
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
   * DELETE binding facts — revocation-class (decision 7): the deny is applied
   * synchronously on this path after the append, by marking the authoritative
   * `Grant` row `revokedAt`. That is the head every migrated organization
   * decides from, so the deny holds before the call returns even with the
   * queue stopped. The compat `RoleBinding` is NOT deleted here — the fold
   * sweeps it when the queue runs — so an organization rolled back to legacy
   * inside a queue-stopped window can still read the stale binding until the
   * projection catches up. Absent ids are no-ops.
   */
  async revokeBindings({
    organizationId,
    bindingIds,
    actor,
    reason,
  }: {
    organizationId: string;
    bindingIds: string[];
    actor: LedgerActor;
    reason?: string;
  }): Promise<void> {
    if (bindingIds.length === 0) return;
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
    await this.appendGrantRevocation({
      organizationId,
      bindingIds,
      actor,
      ...(reason ? { reason } : {}),
    });
  }

  /**
   * Revoke every binding matching a filter; answers how many it revoked.
   *
   * On the LEDGER fork the count is ADVISORY: it is the number of rows the
   * lagging compat projection could see when the filter ran. The event
   * carries a selector where one can be expressed, so the fold's sweep can
   * revoke grants the count never included — `0` means "none visible yet",
   * not "none existed". Callers must not derive existence from it. On the
   * LEGACY fork (below) there is no fold to sweep anything later, so the
   * delete is a single `deleteMany(where)` statement and its count is exact.
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
    // `organizationId` LAST, so a caller's filter can never widen the
    // tenancy the caller named.
    const legacyWhere = { ...where, organizationId };

    if (!(await this.onLedger(organizationId))) {
      // The pre-ledger, filtered revoke: ONE `deleteMany(where)` statement,
      // not a read followed by a delete-by-ids. There is no fold here to
      // sweep a row that lands in the gap between the two — a row matching
      // the filter, created between a read and a later delete, has to be
      // caught by the single statement or it survives the revoke that was
      // meant to catch it.
      const { count } = await this.prisma.roleBinding.deleteMany({
        where: legacyWhere,
      });
      await this.recordLegacyAudit({
        organizationId,
        actor,
        verb: "revoke",
        createdAt: new Date(this.now()),
        facts:
          count > 0
            ? [{ where: legacyWhere, count, ...(reason ? { reason } : {}) }]
            : [],
      });
      await bumpAuthzEpoch({ organizationId });
      return count;
    }

    // The compat head is not the whole head. A Grant-head row a custom-role
    // import wrote (roleKey with no compat binding), a PLATFORM-tier row, or
    // one whose compat write hit a swallowed conflict has no RoleBinding to
    // enumerate, so revoking only the ids `roleBinding.findMany` returns would
    // leave those resolving. Mirror `offboardMember`: union the compat ids
    // with the Grant-head rows the same filter names.
    const bindingRows = await this.prisma.roleBinding.findMany({
      where: legacyWhere,
      select: { id: true },
    });
    const grantWhere = grantWhereFromBindingWhere(where, organizationId);
    const grantRows = grantWhere
      ? await this.prisma.grant.findMany({
          where: grantWhere,
          select: { id: true },
        })
      : [];
    const bindingIds = [
      ...new Set([
        ...bindingRows.map((row) => row.id),
        ...grantRows.map((row) => row.id),
      ]),
    ];
    // revokeBindings early-returns on an empty id list, so no selector-only
    // fact is appended when nothing matched — the behaviour the old
    // skipAppendWhenNoMatches flag stood in for, now intrinsic.
    await this.revokeBindings({
      organizationId,
      bindingIds,
      actor,
      ...(reason ? { reason } : {}),
    });
    return bindingIds.length;
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
        verb: "revoke",
        createdAt: new Date(this.now()),
        facts: [{ userId, revokedGrantIds }],
      });
      await bumpAuthzEpoch({ organizationId });
      return;
    }
    // Offboarding is N revocations sharing one reason, not an event of its
    // own: a person is not an aggregate here, and an event that named one
    // would have to straddle every grant they hold.
    const offboardedAtMs = this.now();
    const batchId = newLedgerCommandId();
    const senders = (await this.commands()).commands;
    await Promise.all(
      revokedGrantIds.map((grantId) =>
        senders.revokeGrant.send({
          tenantId: organizationId,
          organizationId,
          commandId: `${batchId}:${grantId}`,
          grantId,
          reason: `offboarded:${userId}`,
          actor,
          occurredAtMs: offboardedAtMs,
        }),
      ),
    );
    await this.enforcement.enforceGrantRevocation({
      organizationId,
      grantIds: revokedGrantIds,
      reason: "offboard",
      // Same instant and reason as the events above — see appendGrantRevocation.
      revokedAt: new Date(offboardedAtMs),
      revokedReason: `offboarded:${userId}`,
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
      return await this.defineRoleImperatively({
        organizationId,
        roleId,
        name,
        description,
        permissions,
        kind,
        actor,
        occurredAtMs,
      });
    }
    await (await this.commands()).commands.defineRole.send({
      tenantId: organizationId,
      organizationId,
      commandId: newLedgerCommandId(),
      role: {
        roleId,
        name,
        ...(description ? { description } : {}),
        permissions,
        kind,
        occurredAtMs,
      },
      actor,
    });
    // Always held. A role row is a foreign key target: the grant attach that
    // normally follows writes a compat RoleBinding pointing at this role, and
    // that write fails if the role row is not there yet. Commands are queued
    // per command name, not per organization, so `attachGrants` can be picked
    // up before `defineRoles` and cannot stand in for this hold.
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
          samePermissions({ stored: row.permissions, wanted: permissions })
        );
      },
    });
    await bumpAuthzEpoch({ organizationId });
  }

  /**
   * The pre-ledger role write. `role_defined` collapsed the editor's create
   * and update into one verb; the upsert is that same collapse against the
   * table, keyed on the id the caller minted — organization scoped on the
   * update so a role can never be edited across tenants. The
   * name-uniqueness pre-check lives at the service layer (`assertNameFree`)
   * and runs on both sides — but it is advisory, read ahead of the append
   * rather than inside it, so two concurrent renames can still both pass it
   * and race for the same `(organizationId, name)` unique index here. The
   * loser gets the deterministic conflict rather than a raw Prisma error
   * degrading to an unknown 500.
   */
  private async defineRoleImperatively({
    organizationId,
    roleId,
    name,
    description,
    permissions,
    kind,
    actor,
    occurredAtMs,
  }: {
    organizationId: string;
    roleId: string;
    name: string;
    description?: string;
    permissions: string[];
    kind: "custom" | "system_api_key";
    actor: LedgerActor;
    occurredAtMs: number;
  }): Promise<void> {
    try {
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
    } catch (error) {
      if (isUniqueViolation(error)) throw new RoleDuplicateNameError();
      throw error;
    }
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
    awaitProjection = true,
  }: {
    organizationId: string;
    roleId: string;
    actor: LedgerActor;
    /**
     * Whether to hold for the projection to drop the role row. On by
     * default: a caller that deletes a role usually needs the name free
     * again straight away. A caller that only retires a role nothing reads
     * any more turns it off and saves a full fold pickup cycle on the
     * request; the append is durable either way and the fold converges.
     * Nothing here depends on the ordering of other commands, which the
     * queue does not give: command jobs are grouped per command name.
     */
    awaitProjection?: boolean;
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
    if (awaitProjection) {
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
    }
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
    // Deadline uses wall-clock time, not `this.now()`: `deps.now` is
    // injectable business time (frozen in tests for deterministic
    // `occurredAtMs`), and a frozen clock would make this poll loop unable to
    // ever time out.
    const deadline = Date.now() + poll.timeoutMs;
    for (;;) {
      if (await check()) return;
      if (Date.now() >= deadline) {
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
function _ledgerScopeType(value: unknown): LedgerScopeType | undefined {
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
  source: GrantEventSource;
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
function samePermissions({
  stored,
  wanted,
}: {
  stored: unknown;
  wanted: string[];
}): boolean {
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
 * The migration never reaches this writer at all, and the read-through mint
 * is gated off for an unmigrated organization, so in practice nothing is
 * filtered here — the rule is stated anyway so the two audit paths cannot
 * drift into disagreeing about what earns a row. It reads the subscriber's
 * OWN list rather than restating it, which is what makes that guarantee
 * mechanical instead of a promise in a comment.
 */
function auditableSource(source: GrantEventSource): boolean {
  return !NON_AUDITABLE_SOURCES.includes(source);
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
  type: "user" | "group" | "apiKey";
  id: string;
} {
  if (principal.userId !== undefined) {
    return { type: "user", id: principal.userId };
  }
  if (principal.groupId !== undefined) {
    return { type: "group", id: principal.groupId };
  }
  return { type: "apiKey", id: principal.apiKeyId };
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

/**
 * Translate a compat `RoleBinding` filter into the equivalent `Grant`-head
 * predicate, so a filtered revoke reaches Grant rows the compat head never
 * represented (a `roleKey`-only import, a PLATFORM-tier row).
 *
 * A bounded translation over exactly the columns the callers filter on
 * (`apiKeyId` / `groupId` / `userId` → principal; `customRoleId` → the
 * `custom:<id>` roleKey; `scopeType` / `scopeId` → the same tier and id on
 * the Grant head; `id` shared by construction). Any other shape returns
 * null and the caller falls back to the compat ids alone — the pre-existing
 * behaviour, never a wrong revoke. This is the interim until the filter
 * becomes the closed vocabulary `revokeBindingsWhere` documents.
 */
function grantWhereFromBindingWhere(
  where: Prisma.RoleBindingWhereInput,
  organizationId: string,
): Prisma.GrantWhereInput | null {
  const known = new Set([
    "apiKeyId",
    "groupId",
    "userId",
    "customRoleId",
    "scopeType",
    "scopeId",
    "id",
    "organizationId",
  ]);
  if (Object.keys(where).some((key) => !known.has(key))) return null;

  const grantWhere: Prisma.GrantWhereInput = { organizationId };

  const scope = scopeFromBindingFilter(where);
  if (scope === null) return null;
  Object.assign(grantWhere, scope);

  const principal = (
    [
      ["apiKeyId", "API_KEY"],
      ["groupId", "GROUP"],
      ["userId", "USER"],
    ] as const
  ).find(([field]) => where[field] != null);
  if (principal) {
    const value = where[principal[0]];
    // Only a plain-string principal id is translated; an operator shape here
    // is outside the caller vocabulary, so bail rather than guess.
    if (typeof value !== "string") return null;
    grantWhere.principalType = principal[1];
    grantWhere.principalId = value;
  }

  if (where.customRoleId != null) {
    const roleKey = roleKeyFromCustomRoleFilter(where.customRoleId);
    if (roleKey === null) return null;
    grantWhere.roleKey = roleKey;
  }

  if (where.id != null)
    grantWhere.id = where.id as Prisma.GrantWhereInput["id"];

  return grantWhere;
}

/**
 * A scoped filter names the SAME tier and id on the Grant head — the three
 * compat tiers spell identically in `GrantScopeType`. This is what lets a
 * scoped replacement revoke (team member removal, invite replacement,
 * team-role replacement) reach a Grant-only row: without it those callers
 * fell back to the compat ids and a migrated organization kept a live
 * roleKey-only grant after the role was replaced. Operator shapes are
 * outside the caller vocabulary, so null and the caller bails.
 */
function scopeFromBindingFilter(
  where: Prisma.RoleBindingWhereInput,
): Pick<Prisma.GrantWhereInput, "scopeType" | "scopeId"> | null {
  const scope: Pick<Prisma.GrantWhereInput, "scopeType" | "scopeId"> = {};
  if (where.scopeType != null) {
    if (typeof where.scopeType !== "string") return null;
    scope.scopeType = where.scopeType;
  }
  if (where.scopeId != null) {
    if (typeof where.scopeId !== "string") return null;
    scope.scopeId = where.scopeId;
  }
  return scope;
}

/** A `customRoleId` filter as the `custom:<id>` roleKey predicate it names —
 *  a plain string or an `in` list; any other operator shape is outside the
 *  caller vocabulary, so null and the caller bails. */
function roleKeyFromCustomRoleFilter(
  value: NonNullable<Prisma.RoleBindingWhereInput["customRoleId"]>,
): Prisma.GrantWhereInput["roleKey"] | null {
  if (typeof value === "string") return `custom:${value}`;
  const ids = value.in;
  if (!Array.isArray(ids)) return null;
  return { in: ids.map((id) => `custom:${id}`) };
}
