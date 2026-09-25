/**
 * The grants ledger's app-side writer (ADR-092 §13): the ONE storage engine
 * behind every grant mutation, waiting (bounded) for the projection to land
 * attach- and role-shaped writes before returning (ADR-007's breaker doctrine).
 */
import type { LedgerActor } from "@langwatch/actor";
import {
  AuthzGrantNotConfirmedError,
  type DefineRoleCommandData,
  type GrantEventSource,
  type RevokeGrantCommandData,
} from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal, nowInstant, toDate } from "@langwatch/time";

import type { AuthzCompatibilityLedger } from "../app/authz.app.ts";
import type { AuthzEpochRepository } from "../repositories/authz-epoch.repository.ts";
import {
  BindingMissingError,
  DuplicateBindingError,
  type RoleBindingWrite,
} from "../repositories/authz-grant.repository.ts";
import type { AuthzMembershipStampRepository } from "../repositories/authz-membership-stamp.repository.ts";
import type { AuthzDatabase } from "../repositories/authz-read.repository.ts";
import { bindingIdentityKey } from "../repositories/eventing/eventing.authz-grant.mapper.ts";
import { liveGrants, liveRoles } from "../repositories/eventing/eventing.authz-live-rows.mapper.ts";
import {
  compatBindingFromGrantFact,
  GRANT_ROW_COLUMNS,
  grantRowFromStored,
  grantRowToFact,
} from "../repositories/prisma/prisma.authz-grant.mapper.ts";
import {
  carriesRoleKey,
  grantWhereFromBindingWhere,
  grantIdentityWhere,
  newCommandId,
  principalForWhere,
  roleKeyFor,
  samePermissions,
  storedId,
} from "../repositories/prisma/prisma.authz-ledger.mapper.ts";
import type { PrismaAuthzRevocationRepository } from "../repositories/prisma/prisma.authz-revocation.repository.ts";
import {
  membershipFenceFields,
  userIdsNeedingStamp,
  validateMembershipBootstrap,
} from "../rules/membership-stamp-fence.rules.ts";
import type { AuthzGrantsCommandDispatcher } from "../services/authz-grants-command-dispatcher.service.ts";

const logger = createLogger("langwatch:authz:ledger");

/**
 * Which writer authored a runtime fact — the event's `source` field.
 */
export type LedgerWriteSource = GrantEventSource;

// A background caller waiting on this read-your-writes poll is not being
// watched by a person — the only cost of a lazy poll is a job slot, and the
// alternative (acting on a fact the log may not hold yet) is the defect this
// wait exists to prevent. Over an 8s window, 250ms costs at most thirty-two
// reads and no accuracy.
const CONVERGENCE_POLL_MS = 250;
const CONVERGENCE_TIMEOUT_MS = 8_000;

export type LedgerBindingAttach = Omit<RoleBindingWrite, "organizationId"> & {
  /** Internal generation captured by a membership transaction. Callers that
   *  create the membership before emitting leave this unset; the writer reads
   *  and locks the live row itself. */
  membershipStamp?: string;
  /** Founder-only marker for a membership created in the same transaction. */
  membershipBootstrap?: boolean;
};

/**
 * The audience a resource fact names. `ShareVisibility`'s three values in the ledger's own
 * vocabulary — PUBLIC is "anyone" (id null, because there is nobody to name), and the
 * other two name the organization or project whose members the link is for.
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
 * The one principal a write names, in the ledger's exactly-one shape. Call sites carry three
 * optional columns (the legacy row shape); the ledger carries a union that makes "two
 * principals on one row" unrepresentable, and this is the single place the two meet.
 */
export type AttachOutcome = {
  /** Binding ids actually emitted (duplicates skipped when asked to). */
  attached: string[];
  /** Binding ids of pre-existing identical rows the write skipped. */
  duplicates: string[];
};

type LedgerGrantDelegate = {
  findFirst(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
  count(args: unknown): Promise<number>;
};

/** The grant head is the only one the writer reads: every organization writes to the ledger. */
export type AuthzLedgerDatabase = Omit<AuthzDatabase, "grant"> & {
  grant: LedgerGrantDelegate;
};

export type EventingAuthzLedgerAdapterOptions = {
  database: AuthzLedgerDatabase;
  dispatcher: AuthzGrantsCommandDispatcher;
  epoch: AuthzEpochRepository;
  revocation: PrismaAuthzRevocationRepository;
  /** The membership lifetime a USER attach is fenced to. */
  membershipStamps: AuthzMembershipStampRepository;
  now?: () => number;
  newCommandId?: () => string;
  poll?: { intervalMs: number; timeoutMs: number };
};

export type AuthzRoleBindingFilter = Record<string, unknown> & {
  apiKeyId?: unknown;
  groupId?: unknown;
  userId?: unknown;
  customRoleId?: unknown;
  scopeType?: unknown;
  scopeId?: unknown;
  id?: unknown;
  organizationId?: unknown;
};

/**
 * The injected ledger adapter. Every verb bumps the organization's authz
 * epoch after its write lands (decision 19: the epoch stays until contract;
 * the projection cursor is alongside, not instead).
 */
export class EventingAuthzLedgerAdapter implements AuthzCompatibilityLedger {
  /**
   * Only the one sanctioned direct projection write (decision 7) — typed to
   * exactly that member so the writer cannot quietly grow a dependency on
   * the projection store's fold-side surface.
   */
  static create(options: EventingAuthzLedgerAdapterOptions): EventingAuthzLedgerAdapter {
    return new EventingAuthzLedgerAdapter(options);
  }

  private constructor(private readonly options: EventingAuthzLedgerAdapterOptions) {}

  private now(): number {
    return this.options.now?.() ?? nowInstant().epochMilliseconds;
  }

  private commands() {
    return this.options.dispatcher.commands();
  }

  /**
   * INSERT one or more binding facts. An arrow instance property, not a
   * prototype method, so a test's stand-in stub can be asserted on directly.
   */
  attachBindings = async ({
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
    source?: LedgerWriteSource;
    onDuplicate: "reject" | "skip";
    /**
     * A caller-derived command id, for writes that are not a user action and therefore have no
     * retry to remember one (decision 23: migration-shaped writers derive theirs from the
     * source row).
     */
    commandId?: string;
    /**
     * The fact's business time. Backdating writers pass the source row's own timestamp so the
     * grant keeps the time it really started — and so a content-derived grant id, whose KSUID
     * timestamp IS this value, stays stable across re-emissions.
     */
    occurredAtMs?: number;
    /**
     * Whether to hold for the projection to land the rows. On by default: a caller that just
     * wrote usually reads next.
     */
    awaitProjection?: boolean;
    /**
     * Whether an unlanded projection is an error. Follows `awaitProjection`:
     * a caller that waits is a caller that reads next, so a wait that ran out
     * is {@link AuthzGrantNotConfirmedError} rather than a silent lie.
     */
    requireProjection?: boolean;
  }): Promise<AttachOutcome> => {
    if (bindings.length === 0) return { attached: [], duplicates: [] };

    for (const binding of bindings) {
      validateMembershipBootstrap({ organizationId, binding });
    }

    const { fresh, duplicates } = await this.partitionByIdentity({
      organizationId,
      bindings,
      onDuplicate,
    });
    if (fresh.length === 0) return { attached: [], duplicates };

    const occurredAtMs = occurredAtOverrideMs ?? this.now();
    // An import states the lifetime its own inventory read, so it neither
    // needs nor may take the live lock.
    const membershipStamps =
      source === "migration"
        ? new Map<string, string>()
        : await this.captureMembershipStamps({ organizationId, bindings: fresh });
    // One command per grant, and a command id derived from the batch's own
    // so a retry of the same attach dedupes per grant at the event store.
    const batchId = commandId ?? this.options.newCommandId?.() ?? newCommandId();
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
            ...membershipFenceFields(binding, membershipStamps),
          },
        }),
      ),
    );

    const wanted = fresh.map((binding) => binding.bindingId);
    if (awaitProjection || requireProjection) {
      await this.awaitProjection({
        what: `attach of ${wanted.length} binding(s)`,
        organizationId,
        // The CANONICAL Grant head, not the compat RoleBinding rows: a
        // compatibility-only row is one the fold has not authored, and a
        // revoked one confirms an attach that no longer grants anything.
        check: async () => {
          const present = await this.options.database.grant.count({
            where: {
              organizationId,
              revokedAt: null,
              OR: fresh.map((binding) => ({
                id: binding.bindingId,
                ...grantIdentityWhere(binding),
                occurredAt: { gte: toDate(Temporal.Instant.fromEpochMilliseconds(occurredAtMs)) },
              })),
            },
          });
          return present === wanted.length;
        },
        required: requireProjection,
      });
    }
    await this.options.epoch.bump({ organizationId });
    return { attached: wanted, duplicates };
  };

  /**
   * Each USER principal's current lifetime, read under its membership row
   * lock. A user with no live membership refuses the batch: letting the grant
   * through unstamped is the race this exists to close.
   */
  private async captureMembershipStamps({
    organizationId,
    bindings,
  }: {
    organizationId: string;
    bindings: LedgerBindingAttach[];
  }): Promise<Map<string, string>> {
    const userIds = userIdsNeedingStamp(bindings);
    if (userIds.length === 0) return new Map();

    const rows = await this.options.membershipStamps.findLockedStamps({
      organizationId,
      userIds,
    });
    const stamps = new Map(rows.map((row) => [row.userId, row.membershipStamp]));
    if (userIds.some((userId) => !stamps.has(userId))) throw new BindingMissingError();
    return stamps;
  }

  /**
   * Split a batch into the bindings that are genuinely new and the ids of the identical live
   * grants already present. A repeat inside the same batch counts as a duplicate of itself.
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
      const existingId = seen.has(key) ? binding.bindingId : existingByIdentity.get(key);
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
    const rows = await liveGrants(this.options.database).findMany({
      where: {
        organizationId,
        OR: bindings.map((binding) => grantIdentityWhere(binding)),
      },
      select: GRANT_ROW_COLUMNS,
    });
    const byIdentity = new Map<string, string>();
    for (const row of rows) {
      const compat = compatBindingFromGrantFact({
        grant: grantRowToFact(grantRowFromStored(row)),
        organizationId,
      });
      if (compat.kind === "noCompatForm") continue;
      const binding = compat.row;
      byIdentity.set(
        bindingIdentityKey({
          principal: binding,
          role: binding.role,
          customRoleId: binding.customRoleId,
          scopeType: binding.scopeType,
          scopeId: binding.scopeId,
        }),
        binding.id,
      );
    }
    return byIdentity;
  }

  /**
   * INSERT one resource fact — a share link, as the ledger states it
   * (ADR-057's possession model intact, delivery-plan decision 22).
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
    await (
      await this.commands()
    ).commands.attachGrant.send({
      tenantId: organizationId,
      organizationId,
      commandId: commandId ?? this.options.newCommandId?.() ?? newCommandId(),
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
        const row = await liveGrants(this.options.database).findFirst({
          where: { id: grantId, organizationId, projectId, scopeType: "RESOURCE" },
          select: { id: true },
        });
        return row !== null;
      },
    });
    await this.options.epoch.bump({ organizationId });
  }

  /**
   * DELETE resource facts.
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
    const revocation: {
      organizationId: string;
      bindingIds: string[];
      actor: LedgerActor;
      reason?: string;
    } = {
      organizationId,
      bindingIds: grantIds,
      actor,
    };
    if (reason) revocation.reason = reason;
    await this.appendGrantRevocation(revocation);
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
    const batchId = this.options.newCommandId?.() ?? newCommandId();
    const senders = (await this.commands()).commands;
    await Promise.all(
      bindingIds.map((grantId) => {
        const command: RevokeGrantCommandData & { tenantId: string } = {
          tenantId: organizationId,
          organizationId,
          commandId: `${batchId}:${grantId}`,
          grantId,
          actor,
          occurredAtMs: revokedAtMs,
        };
        if (reason) command.reason = reason;
        return senders.revokeGrant.send(command);
      }),
    );
    await this.options.revocation.enforceGrantRevocation({
      organizationId,
      grantIds: bindingIds,
      reason: "revocation",
      // The same instant and reason the events above carry, so the row the
      // deny marks is byte-identical to what the queued write would state —
      // the queue's `revokedAt: null` guard makes this mark the durable one.
      revokedAt: Temporal.Instant.fromEpochMilliseconds(revokedAtMs),
      revokedReason: reason ?? null,
    });
    await this.options.epoch.bump({ organizationId });
  }

  /**
   * UPDATE the role one binding carries, keeping its identity. A binding with
   * no live grant is missing; a sibling already holding the target role at the
   * same scope is a duplicate.
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
    const stored = await liveGrants(this.options.database).findFirst({
      where: { id: bindingId, organizationId },
      select: GRANT_ROW_COLUMNS,
    });
    if (stored === null || stored === undefined) throw new BindingMissingError();
    const row = grantRowFromStored(stored);
    const compat = compatBindingFromGrantFact({
      grant: grantRowToFact(row),
      organizationId,
    });
    if (compat.kind === "noCompatForm") throw new BindingMissingError();

    const to = roleKeyFor({ role, customRoleId });
    if (row.roleKey === to) return;
    const sibling = await liveGrants(this.options.database).findFirst({
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

    await (
      await this.commands()
    ).commands.changeGrantRole.send({
      tenantId: organizationId,
      organizationId,
      commandId: this.options.newCommandId?.() ?? newCommandId(),
      grantId: bindingId,
      from: roleKeyFor(compat.row),
      to,
      actor,
      occurredAtMs: this.now(),
    });
    await this.awaitProjection({
      what: `role change on binding ${bindingId}`,
      organizationId,
      check: async () => {
        const updated = await liveGrants(this.options.database).findFirst({
          where: { id: bindingId, organizationId },
          select: { roleKey: true },
        });
        return carriesRoleKey({ row: updated, roleKey: to });
      },
    });
    await this.options.epoch.bump({ organizationId });
  }

  /**
   * DELETE binding facts — revocation-class (decision 7): the deny is applied synchronously
   * on this path after the append, by marking the authoritative `Grant` row `revokedAt`.
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
    const revocation: {
      organizationId: string;
      bindingIds: string[];
      actor: LedgerActor;
      reason?: string;
    } = {
      organizationId,
      bindingIds,
      actor,
    };
    if (reason) revocation.reason = reason;
    await this.appendGrantRevocation(revocation);
  }

  /**
   * Revoke every binding matching a filter; answers how many it revoked. An
   * arrow instance property, not a prototype method, so a test's stand-in
   * stub can be asserted on directly.
   */
  revokeBindingsWhere = async ({
    organizationId,
    where,
    actor,
    reason,
  }: {
    organizationId: string;
    where: AuthzRoleBindingFilter;
    actor: LedgerActor;
    reason?: string;
  }): Promise<number> => {
    if (!organizationId) {
      throw new Error(
        "revokeBindingsWhere refused a filter with no organization: a grant revocation is always tenant-scoped",
      );
    }
    const translation = grantWhereFromBindingWhere(where, organizationId);
    if (translation.kind === "untranslatable") {
      throw new Error("revokeBindingsWhere refused a filter the grant head cannot express");
    }
    const grantRows = await liveGrants(this.options.database).findMany({
      where: translation.where,
      select: { id: true },
    });
    const bindingIds = [...new Set(grantRows.map((row) => storedId(row)))];
    // revokeBindings early-returns on an empty id list, so no selector-only
    // fact is appended when nothing matched — the behaviour the old
    // skipAppendWhenNoMatches flag stood in for, now intrinsic.
    const revocation: {
      organizationId: string;
      bindingIds: string[];
      actor: LedgerActor;
      reason?: string;
    } = {
      organizationId,
      bindingIds,
      actor,
    };
    if (reason) revocation.reason = reason;
    await this.revokeBindings(revocation);
    return bindingIds.length;
  };

  /**
   * Record one member's offboarding: the fact carries every revoked grant id the caller
   * could see, and enforcement deletes those heads synchronously.
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
    const batchId = this.options.newCommandId?.() ?? newCommandId();
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
    await this.options.revocation.enforceGrantRevocation({
      organizationId,
      grantIds: revokedGrantIds,
      reason: "offboard",
      // Same instant and reason as the events above — see appendGrantRevocation.
      revokedAt: Temporal.Instant.fromEpochMilliseconds(offboardedAtMs),
      revokedReason: `offboarded:${userId}`,
    });
    await this.options.epoch.bump({ organizationId });
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
     * Whether an unlanded projection is an error, same contract as
     * {@link EventingAuthzLedgerAdapter.attachBindings}: turned on before
     * handing out the credential, so an unreadable role refuses the mint.
     */
    requireProjection?: boolean;
  }): Promise<void> {
    const occurredAtMs = this.now();
    const role: DefineRoleCommandData["role"] = {
      roleId,
      name,
      permissions,
      kind,
      occurredAtMs,
    };
    if (description) role.description = description;
    await (
      await this.commands()
    ).commands.defineRole.send({
      tenantId: organizationId,
      organizationId,
      commandId: this.options.newCommandId?.() ?? newCommandId(),
      role,
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
      // The CANONICAL Role head, like every other read-your-writes check
      // here: a deleted row confirms nothing, and the compat CustomRole rows
      // can carry a definition the fold never authored.
      check: async () => {
        const row = (await liveRoles(this.options.database).findFirst({
          where: { id: roleId, organizationId },
          select: { name: true, permissions: true },
        })) as { name: string; permissions: unknown } | null;
        return (
          row != null &&
          row.name === name &&
          samePermissions({
            stored: row.permissions,
            wanted: permissions,
          })
        );
      },
      required: requireProjection,
    });
    await this.options.epoch.bump({ organizationId });
  }

  /**
   * Delete one role definition. Bindings carrying the role are the caller's to revoke first
   * (`revokeBindingsWhere({ customRoleId })`) — revocation enforcement makes the deny
   * instant; the definition's disappearance follows through the fold.
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
     * Whether to hold for the projection to drop the role row. On by default: a caller that
     * deletes a role usually needs the name free again straight away.
     */
    awaitProjection?: boolean;
  }): Promise<void> {
    await (
      await this.commands()
    ).commands.deleteRole.send({
      tenantId: organizationId,
      organizationId,
      commandId: this.options.newCommandId?.() ?? newCommandId(),
      roleId,
      actor,
      occurredAtMs: this.now(),
    });
    if (awaitProjection) {
      await this.awaitProjection({
        what: `deletion of role ${roleId}`,
        organizationId,
        check: async () => {
          const present = await liveRoles(this.options.database).findFirst({
            where: { id: roleId, organizationId },
            select: { id: true },
          });
          return present === null;
        },
      });
    }
    await this.options.epoch.bump({ organizationId });
  }

  /**
   * Bounded read-your-writes: poll until the projection reflects the write.
   * The append is durable either way; an unlanded write is
   * {@link AuthzGrantNotConfirmedError} unless the caller said it may converge later.
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
    const poll = this.options.poll ?? {
      intervalMs: CONVERGENCE_POLL_MS,
      timeoutMs: CONVERGENCE_TIMEOUT_MS,
    };
    // Deadline uses wall-clock time, not `this.now()`: `deps.now` is
    // injectable business time (frozen in tests for deterministic
    // `occurredAtMs`), and a frozen clock would make this poll loop unable to
    // ever time out.
    const deadline = nowInstant().epochMilliseconds + poll.timeoutMs;
    let isConverged = await check();
    while (!isConverged && nowInstant().epochMilliseconds < deadline) {
      await new Promise((resolve) => setTimeout(resolve, poll.intervalMs));
      isConverged = await check();
    }
    if (isConverged) return true;

    logger.warn(
      { organizationId, what },
      "grants projection did not land a write within the read-your-writes window; the append is durable and the fold will converge",
    );
    if (required) throw new AuthzGrantNotConfirmedError();
    return false;
  }
}
