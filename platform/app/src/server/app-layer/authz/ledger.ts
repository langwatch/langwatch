/**
 * The grants ledger's app-side writer (ADR-092 §13, delivery plan PR 2):
 * the ONE storage engine behind every grant mutation. Callers keep their own
 * validation and error surfaces; this module owns emission — every write is
 * a command whose ClickHouse append is waited on, the fold lands it in the
 * two-headed Postgres projection through the per-org queue, and
 * revocation-class writes additionally apply their deny effect synchronously
 * (decision 7: the one sanctioned direct projection write, shaped so it can
 * only make deny true early, never grant).
 *
 * Read-your-writes: attach- and role-shaped writes wait (bounded) for the
 * projection to land their rows before returning, so the caller's next read
 * sees what it wrote. The wait is an observation, not inline processing —
 * a fold that cannot run (Redis down) makes the wait time out, the write is
 * still durable (the append landed), and the rows appear when the fold
 * drains (ADR-007's breaker doctrine). Revocations never need the wait:
 * enforcement already deleted the rows.
 *
 * Identity: a runtime fact's grant id is the caller-minted binding KSUID —
 * the same id the row carried under the imperative writer, kept because it
 * is the upstream identity the REST surface already returns to customers
 * (decision 23's house pattern). Retries reuse the commandId, so the same
 * payload — same grant id — dedupes at the event store. Content-derived ids
 * (`deriveGrantId`) remain the import/migration tool, where the fact's
 * identity must survive re-runs with no caller to remember a mint.
 */
import {
  type TeamUserRole as AuthzTeamUserRole,
  roleKeyForTeamRole,
} from "@langwatch/authz";
import {
  BindingMissingError,
  type BindingPrincipalWhere,
  DuplicateBindingError,
  type RoleBindingWrite,
} from "@langwatch/authz-server";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
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
import { AUTHZ_GRANTS_PIPELINE_NAME } from "~/server/event-sourcing/pipelines/authz-grants/schemas/constants";
import { prisma as appPrisma } from "../../db";
import { tryGetApp } from "../app";
import { bumpAuthzEpoch } from "./epoch";
import { PrismaAuthzGrantsProjectionRepository } from "./repositories/authz-grants-projection.prisma.repository";

const logger = createLogger("langwatch:authz:ledger");

export type LedgerActor = { type: "user" | "system"; id: string | null };

/** Which writer authored a runtime fact — the event's `source` field. */
export type LedgerWriteSource = "grants-service" | "scim" | "invite";

type Sender<T> = { send: (data: T) => Promise<unknown> };

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
 * The `authz_grants` pipeline's senders, resolved lazily at send time (the
 * pipeline is being registered while callers' modules load). Boot-time
 * callers run DURING App composition (`tryGetApp()` is null for its first
 * seconds), so a null App is waited out rather than refused; an App whose
 * event-sourcing stack is disabled throws immediately rather than letting
 * DisabledPipeline swallow the send.
 */
export async function authzGrantsCommands(): Promise<{
  commands: AuthzGrantsCommandSenders;
}> {
  const deadline = Date.now() + 30_000;
  let app = tryGetApp();
  while (!app && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    app = tryGetApp();
  }
  if (!app?.eventSourcing?.isEnabled) {
    throw new Error(
      "the grants ledger requires the event-sourcing stack; send refused",
    );
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
  }: {
    organizationId: string;
    bindings: LedgerBindingAttach[];
    actor: LedgerActor;
    source?: LedgerWriteSource;
    onDuplicate: "reject" | "skip";
  }): Promise<AttachOutcome> {
    if (bindings.length === 0) return { attached: [], duplicates: [] };

    const fresh: LedgerBindingAttach[] = [];
    const duplicates: string[] = [];
    const seen = new Set<string>();
    for (const binding of bindings) {
      const key = bindingIdentityKey(binding);
      const existing = seen.has(key)
        ? { id: binding.bindingId }
        : await this.prisma.roleBinding.findFirst({
            where: bindingIdentityWhere({ organizationId, binding }),
            select: { id: true },
          });
      if (existing) {
        if (onDuplicate === "reject") {
          throw new DuplicateBindingError();
        }
        duplicates.push(existing.id);
        continue;
      }
      seen.add(key);
      fresh.push(binding);
    }
    if (fresh.length === 0) return { attached: [], duplicates };

    const occurredAtMs = this.now();
    await (await this.commands()).commands.attachGrants.send({
      tenantId: organizationId,
      organizationId,
      commandId: newLedgerCommandId(),
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
    await bumpAuthzEpoch({ organizationId });
    return { attached: wanted, duplicates };
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
   * DELETE binding facts — revocation-class (decision 7): the deny effect is
   * applied synchronously on this path after the append, so it holds before
   * the call returns even with the queue stopped. Absent ids are no-ops.
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
    await (await this.commands()).commands.revokeGrants.send({
      tenantId: organizationId,
      organizationId,
      commandId: newLedgerCommandId(),
      revocations: bindingIds.map((grantId) => ({
        grantId,
        ...(reason ? { reason } : {}),
      })),
      actor,
      occurredAtMs: this.now(),
    });
    await this.enforcement.enforceGrantRevocation({
      organizationId,
      grantIds: bindingIds,
    });
    await bumpAuthzEpoch({ organizationId });
  }

  /** Revoke every binding matching a filter; answers how many it revoked. */
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
    const rows = await this.prisma.roleBinding.findMany({
      where: { ...where, organizationId },
      select: { id: true },
    });
    await this.revokeBindings({
      organizationId,
      bindingIds: rows.map((row) => row.id),
      actor,
      ...(reason ? { reason } : {}),
    });
    return rows.length;
  }

  /**
   * Record one member's offboarding: the fact carries every revoked grant
   * id, and enforcement deletes those heads synchronously. Membership tables
   * (OrganizationUser, TeamUser, group memberships, invites) are not grant
   * facts — their deletes stay with the caller.
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
      check: async () => {
        const row = await this.prisma.role.findFirst({
          where: { id: roleId, organizationId },
          select: { occurredAt: true },
        });
        return row != null && row.occurredAt.getTime() >= occurredAtMs;
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

function bindingIdentityKey(binding: LedgerBindingAttach): string {
  const principal =
    binding.principal.userId ??
    binding.principal.groupId ??
    binding.principal.apiKeyId;
  const roleIdentity =
    binding.customRoleId === null
      ? `builtin:${binding.role}`
      : `custom:${binding.customRoleId}`;
  return [principal, binding.scopeType, binding.scopeId, roleIdentity].join("");
}
