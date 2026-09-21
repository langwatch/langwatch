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
 * Every grant mutation appends a fact. The subscriber projects expressible
 * facts into the compatibility tables and the revocation repository applies
 * the deny effect synchronously where required.
 *
 * Identity: a runtime fact's grant id is the caller-minted binding KSUID,
 * the id the REST surface already returns to customers (decision 23's
 * house pattern). Retries reuse the commandId so the same payload dedupes
 * at the event store. Content-derived ids (`deriveGrantId`) are the
 * import/migration tool's, where identity must survive re-runs with no
 * caller to remember a mint.
 */
import type { LedgerActor } from "@langwatch/actor";
import { roleKeyForTeamRole, STORED_PRINCIPAL_KIND } from "@langwatch/authz";
import {
  BindingMissingError,
  type BindingPrincipalWhere,
  DuplicateBindingError,
  type GrantEventSource,
  grantFactToCompatBinding,
  grantRowToFact,
  type RoleBindingWrite,
} from "@langwatch/authz-server";
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
import { AUTHZ_GRANT_PIPELINE_NAME } from "~/server/event-sourcing/pipelines/authz-grants/schemas/constants";
import { prisma as appPrisma } from "../../db";
import { BACKGROUND_READ_YOUR_WRITES } from "../_shared/read-your-writes-window";
import { tryGetApp } from "../app";
import { bumpAuthzEpoch } from "./epoch";
import { AuthzGrantNotConfirmedError } from "./errors";
import { PrismaAuthzRevocationRepository } from "./repositories/authz-revocation.prisma.repository";
import { liveGrants, liveRoles } from "./repositories/live-rows";

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

/**
 * The grants ledger waits on the background window: eight seconds, the value
 * it has always used, now named for the reason it is longer than identity's.
 *
 * A grant that is read back before its fold has landed is an authorization
 * answer derived from state the log may not hold, and that is the one class of
 * wrong answer this system must not give. Waiting costs a job slot; being
 * wrong costs a permission decision.
 *
 * The poll moves 150ms -> 250ms, which over a window this long is at most
 * thirty-two reads of the same cursor row instead of fifty-three, and no
 * accuracy: the fold either lands early or is not landing on this timescale.
 *
 * @see ../_shared/read-your-writes-window.ts — why this and identity's
 *      two-second window are two questions rather than one disagreement.
 */
const AUTHZ_CONVERGENCE = BACKGROUND_READ_YOUR_WRITES;

export type LedgerBindingAttach = Omit<RoleBindingWrite, "organizationId"> & {
  /** Internal generation captured by a membership transaction. Callers that
   *  create the membership before emitting leave this unset; the writer reads
   *  and locks the live row itself. */
  membershipStamp?: string;
  /** Founder-only marker for a membership created in the same transaction. */
  membershipBootstrap?: boolean;
};

type BindingRevocationFilter = BindingPrincipalWhere & {
  scopeType?: RoleBindingWrite["scopeType"];
  scopeId?: string;
  customRoleId?: string | { in: string[] };
  id?: string | { notIn: string[] };
};

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
    requireProjection = awaitProjection,
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
    /**
     * Confirmation is required whenever the caller waits. Background writers
     * may explicitly accept a durable append before projection convergence.
     * Requiring confirmation also enables the wait.
     */
    requireProjection?: boolean;
  }): Promise<AttachOutcome> {
    if (bindings.length === 0) return { attached: [], duplicates: [] };

    bindings.forEach((binding) =>
      validateMembershipBootstrap({ organizationId, binding }),
    );

    const { fresh, duplicates } = await this.partitionByIdentity({
      organizationId,
      bindings,
      onDuplicate,
    });
    if (fresh.length === 0) return { attached: [], duplicates };

    const occurredAtMs = occurredAtOverrideMs ?? this.now();
    const membershipStamps =
      source === "migration"
        ? new Map<string, string>()
        : await this.captureMembershipStamps({
            organizationId,
            bindings: fresh,
          });
    // One command per grant, and a command id derived from the batch's own
    // so a retry of the same attach dedupes per grant at the event store.
    const batchId = commandId ?? newLedgerCommandId();
    const senders = (await this.commands()).commands;
    await Promise.all(
      fresh.map(async (binding) => {
        const membershipStamp = membershipStampForBinding(
          binding,
          membershipStamps,
        );
        await senders.attachGrant.send({
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
            ...(membershipStamp ? { membershipStamp } : {}),
            ...(binding.membershipBootstrap
              ? { membershipBootstrap: binding.membershipBootstrap }
              : {}),
          },
        });
      }),
    );

    const wanted = fresh.map((binding) => binding.bindingId);
    if (awaitProjection || requireProjection) {
      await this.awaitProjection({
        what: `attach of ${wanted.length} binding(s)`,
        organizationId,
        check: async () => {
          const present = await this.prisma.grant.count({
            where: {
              organizationId,
              revokedAt: null,
              OR: fresh.map((binding) => ({
                id: binding.bindingId,
                ...grantIdentityForBinding(binding),
                occurredAt: { gte: new Date(occurredAtMs) },
              })),
            },
          });
          return present === wanted.length;
        },
        required: requireProjection,
      });
    }
    await bumpAuthzEpoch({ organizationId });
    return { attached: wanted, duplicates };
  }

  /**
   * Capture the current lifetime of each USER principal while holding its
   * membership row lock. The lock serializes this snapshot with offboarding;
   * the event carries the stamp after the transaction releases it, and the
   * projection checks the same generation before inserting the grant.
   */
  private async captureMembershipStamps({
    organizationId,
    bindings,
  }: {
    organizationId: string;
    bindings: LedgerBindingAttach[];
  }): Promise<Map<string, string>> {
    const userIds = [
      ...new Set(
        bindings.flatMap((binding) =>
          binding.membershipStamp || !binding.principal.userId
            ? []
            : [binding.principal.userId],
        ),
      ),
    ];
    if (userIds.length === 0) return new Map();

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ userId: string; membershipStamp: string }>
      >`
        SELECT "userId", "membershipStamp"
        FROM "OrganizationUser"
        WHERE "organizationId" = ${organizationId}
          AND "userId" IN (${Prisma.join(userIds)})
          AND "disabledAt" IS NULL
        FOR UPDATE
      `;
      const stamps = new Map(
        rows.map((row) => [row.userId, row.membershipStamp]),
      );
      const missingUserId = userIds.find((userId) => !stamps.has(userId));
      if (missingUserId) throw new BindingMissingError();
      return stamps;
    });
  }

  /**
   * Split a batch into the bindings that are genuinely new and the ids of the
   * identical rows already present. The pre-check also gives duplicate
   * handling a stable result when a request is retried.
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
    const rows = await liveGrants(this.prisma).findMany({
      where: {
        organizationId,
        OR: bindings.map(grantIdentityForBinding),
      },
    });
    const byIdentity = new Map<string, string>();
    for (const row of rows) {
      const binding = grantFactToCompatBinding({
        grant: grantRowToFact(row),
        organizationId,
      });
      byIdentity.set(
        bindingIdentityKey({ ...binding, principal: ledgerPrincipal(binding) }),
        row.id,
      );
    }
    return byIdentity;
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
   * Resource facts use this same append path as binding facts.
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
    const { commands } = await this.commands();
    await commands.attachGrant.send({
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
        const row = await liveGrants(this.prisma).findFirst({
          where: {
            id: grantId,
            organizationId,
            projectId,
            scopeType: "RESOURCE",
          },
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
   * Revocation always appends to the ledger and applies the deny effect
   * synchronously, so access cannot return while the compatibility projection
   * catches up.
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
    const row = await liveGrants(this.prisma).findFirst({
      where: { id: bindingId, organizationId },
    });
    if (!row) throw new BindingMissingError();
    const binding = grantFactToCompatBinding({
      grant: grantRowToFact(row),
      organizationId,
    });

    const to = roleKeyFor({ role, customRoleId });
    if (row.roleKey === to) return;
    const sibling = await liveGrants(this.prisma).findFirst({
      where: {
        organizationId,
        principalType: row.principalType,
        principalId: row.principalId,
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        roleKey: to,
        id: { not: bindingId },
      },
      select: { id: true },
    });
    if (sibling) throw new DuplicateBindingError();

    const { commands } = await this.commands();
    await commands.changeGrantRole.send({
      tenantId: organizationId,
      organizationId,
      commandId: newLedgerCommandId(),
      grantId: bindingId,
      from: roleKeyFor(binding),
      to,
      actor,
      occurredAtMs: this.now(),
    });
    await this.awaitProjection({
      what: `role change on binding ${bindingId}`,
      organizationId,
      check: async () => {
        const updated = await liveGrants(this.prisma).findFirst({
          where: { id: bindingId, organizationId },
          select: { roleKey: true },
        });
        return updated?.roleKey === to;
      },
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
    await this.appendGrantRevocation({
      organizationId,
      bindingIds,
      actor,
      ...(reason ? { reason } : {}),
    });
  }

  /** Revoke this principal's matching live grants within one organization. */
  async revokeBindingsWhere({
    organizationId,
    where,
    actor,
    reason,
  }: {
    organizationId: string;
    where: BindingRevocationFilter;
    actor: LedgerActor;
    reason?: string;
  }): Promise<number> {
    if (!organizationId) {
      throw new Error("A grant revocation must name an organization");
    }
    const principal = principalForWhere(where);
    const { customRoleId } = where;
    const roleKey =
      typeof customRoleId === "string"
        ? `custom:${customRoleId}`
        : customRoleId && { in: customRoleId.in.map((id) => `custom:${id}`) };
    const grants = await liveGrants(this.prisma).findMany({
      where: {
        organizationId,
        principalType: STORED_PRINCIPAL_KIND[principal.type],
        principalId: principal.id,
        ...(where.scopeType !== void 0 && { scopeType: where.scopeType }),
        ...(where.scopeId !== void 0 && { scopeId: where.scopeId }),
        ...(where.id !== void 0 && { id: where.id }),
        ...(roleKey !== void 0 && { roleKey }),
      },
      select: { id: true },
    });
    const bindingIds = grants.map((grant) => grant.id);
    await this.revokeBindings({ organizationId, bindingIds, actor, reason });
    return bindingIds.length;
  }

  /**
   * Revoke the grant IDs observed for a departing member and deny them
   * synchronously. Membership deletion stays with the caller. This snapshot
   * does not cover a concurrent attach that has not reached the projection.
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
    requireProjection = true,
  }: {
    organizationId: string;
    roleId: string;
    name: string;
    description?: string;
    permissions: string[];
    kind: "custom" | "system_api_key";
    actor: LedgerActor;
    /**
     * Require the role to be readable before reporting success. Background
     * callers may explicitly allow an accepted write to converge later.
     */
    requireProjection?: boolean;
  }): Promise<void> {
    const occurredAtMs = this.now();
    const { commands } = await this.commands();
    await commands.defineRole.send({
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
    await this.awaitProjection({
      what: `definition of role ${roleId}`,
      organizationId,
      check: async () => {
        const row = await liveRoles(this.prisma).findFirst({
          where: { id: roleId, organizationId },
          select: { name: true, permissions: true },
        });
        return (
          row != null &&
          row.name === name &&
          samePermissions({ stored: row.permissions, wanted: permissions })
        );
      },
      required: requireProjection,
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
    const { commands } = await this.commands();
    await commands.deleteRole.send({
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
          const present = await liveRoles(this.prisma).findFirst({
            where: { id: roleId, organizationId },
            select: { id: true },
          });
          return present === null;
        },
      });
    }
    await bumpAuthzEpoch({ organizationId });
  }

  /**
   * Bounded read-your-writes: poll until the projection reflects the write.
   * Answers whether the rows landed inside the window.
   *
   * Timing out is not in itself a failure — the append landed and the fold
   * will drain (Redis-down doctrine), so the caller's write is durable either
   * way. It IS a failure for a caller whose next step only makes sense once
   * the rows are readable, which is what `requireProjection` states.
   */
  private async awaitProjection({
    what,
    organizationId,
    check,
    required = true,
  }: {
    what: string;
    organizationId: string;
    check: () => Promise<boolean>;
    required?: boolean;
  }): Promise<boolean> {
    const poll = this.deps.poll ?? {
      intervalMs: AUTHZ_CONVERGENCE.pollMs,
      timeoutMs: AUTHZ_CONVERGENCE.timeoutMs,
    };
    // Deadline uses wall-clock time, not `this.now()`: `deps.now` is
    // injectable business time (frozen in tests for deterministic
    // `occurredAtMs`), and a frozen clock would make this poll loop unable to
    // ever time out.
    const deadline = Date.now() + poll.timeoutMs;
    for (;;) {
      if (await check()) return true;
      if (Date.now() >= deadline) {
        logger.warn(
          { organizationId, what },
          "grants projection did not land a write within the read-your-writes window; the append is durable and the fold will converge",
        );
        if (required) throw new AuthzGrantNotConfirmedError();
        return false;
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

function roleKeyFor({
  role,
  customRoleId,
}: {
  role: RoleBindingWrite["role"];
  customRoleId: string | null;
}): string {
  return customRoleId === null
    ? roleKeyForTeamRole(role)
    : `custom:${customRoleId}`;
}

function grantIdentityForBinding(binding: LedgerBindingAttach) {
  const principal = principalForWhere(binding.principal);
  return {
    principalType: STORED_PRINCIPAL_KIND[principal.type],
    principalId: principal.id,
    roleKey: roleKeyFor(binding),
    scopeType: binding.scopeType,
    scopeId: binding.scopeId,
  };
}

function membershipStampForBinding(
  binding: LedgerBindingAttach,
  stamps: Map<string, string>,
): string | undefined {
  if (binding.membershipStamp) return binding.membershipStamp;
  const userId = binding.principal.userId;
  return userId ? stamps.get(userId) : undefined;
}

function validateMembershipBootstrap({
  organizationId,
  binding,
}: {
  organizationId: string;
  binding: LedgerBindingAttach;
}): void {
  if (!binding.membershipBootstrap) return;
  const scopeIsAllowed =
    binding.scopeType === "TEAM" ||
    (binding.scopeType === "ORGANIZATION" &&
      binding.scopeId === organizationId);
  if (
    !binding.principal.userId ||
    !binding.membershipStamp ||
    binding.role !== "ADMIN" ||
    binding.customRoleId !== null ||
    !scopeIsAllowed
  ) {
    throw new Error(
      "membershipBootstrap is only valid for stamped USER ADMIN organization/team bindings",
    );
  }
}

export function principalForWhere(principal: BindingPrincipalWhere): {
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
