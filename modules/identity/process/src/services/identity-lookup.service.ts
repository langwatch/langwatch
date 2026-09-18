import type { AuditLogApi, AuditLogJsonValue } from "@langwatch/audit-log-contract";
import {
  IDENTITY_LOOKUP_AUDIT_PREFIX,
  type IdentityLookupAnswer,
  type LookupOperatorActivityRow,
  type LookupPerson,
  type LookupPersonDetail,
  type LookupWaiting,
  normalizeIdentifierValue,
  OPERATOR_ACTIVITY_LIMIT,
  routingIdentifierOf,
} from "@langwatch/identity-contract";
import type { RateLimiter } from "@langwatch/process-stores";

import type {
  IdentityLookupRepository,
  LookupIdentifierRow,
} from "../repositories/identity-lookup.repository.ts";
import type { SsoPlatformOperatorRepository } from "../repositories/sso-connection.repository.ts";
import type { SignInRouterService } from "./signin-router.service.ts";

/** The operator issuing a lookup, as this surface knows them. */
export interface OperatorActor {
  userId: string;
}

/**
 * Thrown for every refusal: no platform operator access, and a stranger's
 * budget run out. Both read identically, on purpose (D05 tier 1, line 86).
 */
export class IdentityLookupRefusedError extends Error {
  constructor() {
    super("identity lookup refused");
    this.name = "IdentityLookupRefusedError";
  }
}

export interface IdentityLookupServiceDeps {
  reads: IdentityLookupRepository;
  router: () => Pick<SignInRouterService, "route">;
  platformOperators: SsoPlatformOperatorRepository;
  auditLog: AuditLogApi;
  rateLimiter: RateLimiter;
  now?: () => number;
}

/**
 * The platform operator's identity lookup (D05 tier 1). The read IS the
 * act: every call is authorized and recorded before it answers, and the
 * routing panel calls the auth screens' own router rather than a copy.
 */
export class IdentityLookupService {
  private readonly deps: IdentityLookupServiceDeps;
  private readonly now: () => number;

  static create(deps: IdentityLookupServiceDeps): IdentityLookupService {
    return new IdentityLookupService(deps);
  }

  private constructor(deps: IdentityLookupServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /** An address nobody holds answers with the routing decision and an
   *  empty people list - not an error, and it must not look like one. */
  async resolve({
    address,
    operator,
  }: {
    address: string;
    operator: OperatorActor;
  }): Promise<IdentityLookupAnswer> {
    await this.authorizeAndRecord({
      operator,
      action: "resolve",
      args: { address: normalizeIdentifierValue(address) },
    });

    const routingIdentifier = routingIdentifierOf(address);
    const resolved = routingIdentifier.normalized;

    const decision = await this.deps.router().route({ identifier: address });
    const connection = routingIdentifier.domain
      ? await this.deps.reads.findConnectionForDomain({ domain: routingIdentifier.domain })
      : null;

    const identifiers = await this.deps.reads.findIdentifiersByValue({ value: resolved });
    const people = await this.assemblePeople({ identifiers });

    return {
      typed: address,
      resolved,
      domain: routingIdentifier.domain,
      routing: {
        outcome: decision.outcome,
        reasonCode: decision.reasonCode,
        connectionId: decision.connectionId ?? null,
        methods: decision.methodSet.map((method) => method.id),
        connection,
      },
      people,
    };
  }

  /** One person: their methods in every state, and what is waiting on them. */
  async findPerson({
    userId,
    address,
    operator,
  }: {
    userId: string;
    address: string;
    operator: OperatorActor;
  }): Promise<LookupPersonDetail | null> {
    await this.authorizeAndRecord({
      operator,
      action: "person",
      args: { userId, address: normalizeIdentifierValue(address) },
      targetId: userId,
    });

    const identifierRows = await this.deps.reads.findIdentifiersForUser({ userId });
    const people = await this.assemblePeople({
      identifiers: identifierRows.filter((row) => row.value === normalizeIdentifierValue(address)),
      fallbackUserIds: [userId],
    });
    const person = people[0];
    if (!person) return null;

    return {
      person,
      identifiers: identifierRows,
      waiting: await this.waitingFor({ person }),
    };
  }

  /** Read off the same trail every repair writes to - not a second one. */
  async recentActivity({
    operator,
  }: {
    operator: OperatorActor;
  }): Promise<readonly LookupOperatorActivityRow[]> {
    await this.authorizeAndRecord({ operator, action: "recentActivity", args: {} });
    return this.deps.reads.findRecentOperatorActivity({ limit: OPERATOR_ACTIVITY_LIMIT });
  }

  /**
   * Record first, then decide whether the caller may proceed - the refused
   * attempt is the one the trail most needs. An operator is never
   * throttled; a stranger's attempts spend a shared budget instead.
   */
  private async authorizeAndRecord({
    operator,
    action,
    args,
    targetId,
  }: {
    operator: OperatorActor;
    action: string;
    args: Record<string, AuditLogJsonValue>;
    targetId?: string;
  }): Promise<void> {
    const isOperator = await this.deps.platformOperators.isPlatformOperator({
      actorId: operator.userId,
    });
    const withinBudget = isOperator || (await this.withinAttemptBudget(operator.userId));

    if (withinBudget) {
      await this.deps.auditLog.record({
        userId: operator.userId,
        action: `${IDENTITY_LOOKUP_AUDIT_PREFIX}${action}`,
        args,
        targetKind: "identityLookup",
        targetId,
      });
    }
    if (!isOperator) throw new IdentityLookupRefusedError();
  }

  private async withinAttemptBudget(userId: string): Promise<boolean> {
    const decision = await this.deps.rateLimiter.check(`identity-lookup-attempt:${userId}`);
    return decision.allowed;
  }

  private async assemblePeople({
    identifiers,
    fallbackUserIds = [],
  }: {
    identifiers: readonly LookupIdentifierRow[];
    fallbackUserIds?: readonly string[];
  }): Promise<readonly LookupPerson[]> {
    const userIds = [...new Set([...identifiers.map((row) => row.userId), ...fallbackUserIds])];
    if (userIds.length === 0) return [];

    const [users, memberships] = await Promise.all([
      this.deps.reads.findUsers({ userIds }),
      this.deps.reads.findMemberships({ userIds }),
    ]);
    const byId = new Map(users.map((user) => [user.userId, user]));

    return userIds.map((userId) => ({
      userId,
      name: byId.get(userId)?.name ?? null,
      email: byId.get(userId)?.email ?? null,
      organizations: memberships
        .filter((row) => row.userId === userId)
        .map((row) => ({
          organizationId: row.organizationId,
          name: row.organizationName,
          role: row.role,
        })),
      holding: identifiers.filter((row) => row.userId === userId),
    }));
  }

  private async waitingFor({ person }: { person: LookupPerson }): Promise<LookupWaiting> {
    const invitationRows = person.email
      ? await this.deps.reads.findInvitations({ email: person.email })
      : [];
    const now = this.now();
    const invitations = invitationRows
      .filter((row) => row.status === "PENDING")
      .map((row) => ({
        inviteId: row.inviteId,
        email: row.email,
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        invitedByName: row.invitedByName,
        status: row.status,
        expiresAtMs: row.expiresAtMs,
        isExpired: row.expiresAtMs !== null && row.expiresAtMs <= now,
      }));
    return { invitations, isEmpty: invitations.length === 0 };
  }
}
