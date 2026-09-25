import type { AuditLogApi, AuditLogJsonValue } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import {
  DOMAIN_CLAIM_QUEUE_LIMIT,
  IDENTITY_LOOKUP_AUDIT_PREFIX,
  IDENTITY_LOOKUP_HISTORY_LIMIT,
  type IdentityLookupAnswer,
  type IdentityLookupOperator,
  type LookupDomainClaim,
  type VerifiedUserDomain,
  type LookupIdentifier,
  type LookupInvitationExpiry,
  type LookupOperatorActivityRow,
  type LookupPerson,
  type LookupPersonDetail,
  type LookupSession,
  type LookupWaiting,
  normalizeIdentifierValue,
  OPERATOR_ACTIVITY_LIMIT,
  routingIdentifierOf,
} from "@langwatch/identity-contract";
import { AdminSurfaceHiddenError } from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { RateLimiter } from "@langwatch/process-stores";
import { Temporal } from "@langwatch/time";

import type { IdentityHistoryRepository } from "../repositories/identity-history.repository.ts";
import type {
  IdentityLookupRepository,
  LookupDomainClaimRow,
  LookupIdentifierRow,
} from "../repositories/identity-lookup.repository.ts";
import type { SsoPlatformOperatorRepository } from "../repositories/sso-connection.repository.ts";
import { newIdentityCommandId } from "../rules/identity-command-id.rules.ts";
import type { IdentityService } from "./identity.service.ts";
import type { LinkProposalService } from "./link-proposal.service.ts";

export interface IdentityLookupServiceDeps {
  reads: IdentityLookupRepository;
  history: IdentityHistoryRepository;
  /** The auth screens' own router, so this answer cannot drift from theirs. */
  router: Pick<AuthApi, "route">;
  identity: () => Pick<IdentityService, "detachIdentifier">;
  links: Pick<LinkProposalService, "confirmLink" | "rejectLink">;
  platformOperators: SsoPlatformOperatorRepository;
  auditLog: AuditLogApi;
  rateLimiter: RateLimiter;
  sessions: Pick<
    AuthApi,
    "listBrowserSessions" | "revokeAllBrowserSessions" | "endBrowserSessionsForIdentifier"
  >;
  invitations: Pick<OrganizationApi, "resendInvitation" | "extendInvitation">;
  now?: () => number;
}

/**
 * The platform operator's identity lookup (D05). The read IS the act: every
 * call is recorded and then gated, and every repair is a guarded command the
 * guards decide - nothing here re-checks a rule they already hold.
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

  /** A system read, not an operator act: nothing is recorded. */
  async findVerifiedDomainsByUserIds({
    userIds,
  }: {
    userIds: readonly string[];
  }): Promise<VerifiedUserDomain[]> {
    return [...(await this.deps.reads.findVerifiedDomains({ userIds }))];
  }

  /** An address nobody holds answers with the routing decision and an
   *  empty people list - not an error, and it must not look like one. */
  async lookupAddress({
    address,
    operator,
  }: {
    address: string;
    operator: IdentityLookupOperator;
  }): Promise<IdentityLookupAnswer> {
    await this.recorded({
      operator,
      action: "resolve",
      args: { address: normalizeIdentifierValue(address) },
    });

    const routingIdentifier = routingIdentifierOf(address);
    const resolved = routingIdentifier.normalized;

    const decision = await this.deps.router.route({ identifier: address, breakGlass: false });
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
      // Looking and repairing are one grant today; two fields because they are two questions.
      canRepair: true,
    };
  }

  /** One person, with every panel the drawer renders. */
  async getLookupPerson({
    userId,
    address,
    operator,
  }: {
    userId: string;
    address: string;
    operator: IdentityLookupOperator;
  }): Promise<LookupPersonDetail> {
    await this.recorded({
      operator,
      action: "person",
      args: { userId, address: normalizeIdentifierValue(address) },
      targetId: userId,
    });

    const history = this.deps.history;

    const identifierRows = await this.deps.reads.findIdentifiersForUser({ userId });
    const [people, entries, sessions] = await Promise.all([
      this.assemblePeople({
        identifiers: identifierRows.filter(
          (row) => row.value === normalizeIdentifierValue(address),
        ),
        fallbackUserIds: [userId],
      }),
      history.findHistory({ userId, limit: IDENTITY_LOOKUP_HISTORY_LIMIT }),
      this.sessionsOf({ userId }),
    ]);
    const person = people[0] ?? emptyPerson(userId);

    return {
      person,
      identifiers: identifierRows.map(toLookupIdentifier),
      waiting: await this.waitingFor({ person, identifiers: identifierRows, history }),
      history: [...entries],
      sessions,
    };
  }

  /** Read off the same trail every repair writes to - not a second one. */
  async findLookupActivity({
    operator,
  }: {
    operator: IdentityLookupOperator;
  }): Promise<LookupOperatorActivityRow[]> {
    await this.recorded({ operator, action: "recentActivity", args: {} });
    return [
      ...(await this.deps.reads.findRecentOperatorActivity({ limit: OPERATOR_ACTIVITY_LIMIT })),
    ];
  }

  /** The claims queue, longest wait first. */
  async findDomainClaimQueue({
    operator,
  }: {
    operator: IdentityLookupOperator;
  }): Promise<LookupDomainClaim[]> {
    await this.recorded({ operator, action: "claimQueue", args: {} });
    const rows = await this.deps.reads.findClaimQueue({ limit: DOMAIN_CLAIM_QUEUE_LIMIT });
    return this.nameOrganizations({ claims: rows });
  }

  /** Straight through to the guard, which refuses a proposal already decided. */
  async confirmProposedSignIn({
    userId,
    proposalId,
    operator,
  }: {
    userId: string;
    proposalId: string;
    operator: IdentityLookupOperator;
  }): Promise<void> {
    await this.recorded({
      operator,
      action: "confirmProposedSignIn",
      args: { userId, proposalId },
      targetId: userId,
    });
    await this.deps.links.confirmLink({
      ...this.operatorCommand({ userId, operator }),
      proposalId,
    });
  }

  async rejectProposedSignIn({
    userId,
    proposalId,
    operator,
  }: {
    userId: string;
    proposalId: string;
    operator: IdentityLookupOperator;
  }): Promise<void> {
    await this.recorded({
      operator,
      action: "rejectProposedSignIn",
      args: { userId, proposalId },
      targetId: userId,
    });
    await this.deps.links.rejectLink({ ...this.operatorCommand({ userId, operator }), proposalId });
  }

  /** Straight through to the guard, which refuses to strand somebody. */
  async detachLookupMethod({
    userId,
    identifierId,
    operator,
  }: {
    userId: string;
    identifierId: string;
    operator: IdentityLookupOperator;
  }): Promise<void> {
    await this.recorded({
      operator,
      action: "detachMethod",
      args: { userId, identifierId },
      targetId: userId,
    });
    await this.deps
      .identity()
      .detachIdentifier({ ...this.operatorCommand({ userId, operator }), identifierId });
  }

  async endLookupSessions({
    userId,
    identifierId,
    operator,
  }: {
    userId: string;
    identifierId: string | null;
    operator: IdentityLookupOperator;
  }): Promise<void> {
    await this.recorded({
      operator,
      action: "endSessions",
      args: { userId, identifierId },
      targetId: userId,
    });
    if (identifierId === null) {
      await this.deps.sessions.revokeAllBrowserSessions({ userId });
      return;
    }
    await this.deps.sessions.endBrowserSessionsForIdentifier({ userId, identifierId });
  }

  async resendLookupInvitation({
    organizationId,
    inviteId,
    operator,
  }: {
    organizationId: string;
    inviteId: string;
    operator: IdentityLookupOperator;
  }): Promise<LookupInvitationExpiry> {
    await this.recorded({
      operator,
      action: "resendInvitation",
      args: { organizationId, inviteId },
      targetId: inviteId,
    });
    const { invite } = await this.deps.invitations.resendInvitation({ organizationId, inviteId });
    return { expiresAtMs: invite.expiration?.getTime() ?? null };
  }

  async extendLookupInvitation({
    organizationId,
    inviteId,
    operator,
  }: {
    organizationId: string;
    inviteId: string;
    operator: IdentityLookupOperator;
  }): Promise<LookupInvitationExpiry> {
    await this.recorded({
      operator,
      action: "extendInvitation",
      args: { organizationId, inviteId },
      targetId: inviteId,
    });
    const { invite } = await this.deps.invitations.extendInvitation({ organizationId, inviteId });
    return { expiresAtMs: invite.expiration?.getTime() ?? null };
  }

  /**
   * Record first, then decide whether the caller may proceed - the refused
   * attempt is the one the trail most needs. An operator is never
   * throttled; a stranger's attempts spend a shared budget instead.
   */
  private async recorded({
    operator,
    action,
    args,
    targetId,
  }: {
    operator: IdentityLookupOperator;
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
    if (!isOperator) throw new AdminSurfaceHiddenError();
  }

  /** The subject's user id is the tenant; the operator is the actor. */
  private operatorCommand({
    userId,
    operator,
  }: {
    userId: string;
    operator: IdentityLookupOperator;
  }): {
    tenantId: string;
    userId: string;
    commandId: string;
    occurredAtMs: number;
    actor: { type: "user"; id: string };
  } {
    return {
      tenantId: userId,
      userId,
      commandId: newIdentityCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "user", id: operator.userId },
    };
  }

  private async withinAttemptBudget(userId: string): Promise<boolean> {
    const decision = await this.deps.rateLimiter.check(`identity-lookup-attempt:${userId}`);
    return decision.allowed;
  }

  private async sessionsOf({ userId }: { userId: string }): Promise<LookupSession[]> {
    const sessions = await this.deps.sessions.listBrowserSessions({ userId });
    return sessions.map((session) => ({
      sessionId: session.sessionId,
      identifierId: session.identifierId,
      createdAtMs: Temporal.Instant.from(session.signedInAt).epochMilliseconds,
      expiresAtMs: Temporal.Instant.from(session.expiresAt).epochMilliseconds,
    }));
  }

  private async assemblePeople({
    identifiers,
    fallbackUserIds = [],
  }: {
    identifiers: readonly LookupIdentifierRow[];
    fallbackUserIds?: readonly string[];
  }): Promise<LookupPerson[]> {
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
      holding: identifiers.filter((row) => row.userId === userId).map(toLookupIdentifier),
    }));
  }

  private async waitingFor({
    person,
    identifiers,
    history,
  }: {
    person: LookupPerson;
    identifiers: readonly LookupIdentifierRow[];
    history: IdentityHistoryRepository;
  }): Promise<LookupWaiting> {
    const domains = [
      ...new Set(identifiers.flatMap((row) => (row.domain === null ? [] : [row.domain]))),
    ];
    const [proposals, invitationRows, claimRows] = await Promise.all([
      history.findProposals({ userId: person.userId }),
      person.email ? this.deps.reads.findInvitations({ email: person.email }) : [],
      this.deps.reads.findClaimsAwaitingReview({ domains }),
    ]);

    const now = this.now();
    const undecided = proposals.filter((proposal) => !proposal.decision);
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
    const domainClaims = await this.nameOrganizations({ claims: claimRows });

    return {
      proposals: undecided,
      invitations,
      domainClaims,
      isEmpty: undecided.length === 0 && invitations.length === 0 && domainClaims.length === 0,
    };
  }

  /** Claims arrive named by organization id alone; one batched read names them. */
  private async nameOrganizations({
    claims,
  }: {
    claims: readonly LookupDomainClaimRow[];
  }): Promise<LookupDomainClaim[]> {
    if (claims.length === 0) return [];
    const named = await this.deps.reads.findOrganizationNames({
      organizationIds: claims.map((claim) => claim.organizationId),
    });
    return claims.map((claim) => ({
      connectionId: claim.connectionId,
      organizationId: claim.organizationId,
      organizationName: named.get(claim.organizationId) ?? null,
      domain: claim.domain,
      waitingSinceMs: claim.waitingSinceMs,
    }));
  }
}

function emptyPerson(userId: string): LookupPerson {
  return { userId, name: null, email: null, organizations: [], holding: [] };
}

function toLookupIdentifier(row: LookupIdentifierRow): LookupIdentifier {
  return {
    identifierId: row.identifierId,
    provider: row.provider,
    value: row.value,
    domain: row.domain,
    state: row.state,
    connectionId: row.connectionId,
    verifiedAtMs: row.verifiedAtMs,
    attachedAtMs: row.attachedAtMs,
    detachedAtMs: row.detachedAtMs,
  };
}
