import {
  type IdentityActor,
  normalizeIdentifierValue,
  routingIdentifierOf,
} from "@langwatch/identity";
import type {
  IdentityService,
  LinkProposalReadsRepository,
  LinkProposalRecord,
  LinkProposalService,
  SignInRouterService,
} from "@langwatch/identity-server";
import { newIdentityCommandId } from "@langwatch/identity-server";
import type {
  IdentityHistoryEntry,
  IdentityHistoryReadsRepository,
} from "./repositories/identity-event-log.repository";
import type {
  IdentityLookupReadsRepository,
  LookupDomainClaimRow,
  LookupIdentifierRow,
  LookupOperatorActivityRow,
} from "./repositories/identity-lookup.prisma.repository";

/** How many identity facts a person's history panel shows. */
export const IDENTITY_LOOKUP_HISTORY_LIMIT = 50;

/** How many claims the queue renders before it stops. */
export const DOMAIN_CLAIM_QUEUE_LIMIT = 50;

/** How many recent operator acts the trail panel shows. */
export const OPERATOR_ACTIVITY_LIMIT = 50;

/** The operator issuing a command, as the surface knows them. */
export interface OperatorActor {
  userId: string;
}

/** Ending sessions, as this surface needs it (D06's `Session.identifierId`
 *  is what makes the per-method variant possible at all). */
export interface OperatorSessionPort {
  endAllForUser(input: { userId: string }): Promise<void>;
  endForIdentifier(input: {
    userId: string;
    identifierId: string;
  }): Promise<void>;
}

/** The two invitation verbs this surface offers. Both already exist for the
 *  organization's own admins; nothing about them changes here except who is
 *  asking, which is what the audit row records. */
export interface OperatorInvitationPort {
  resend(input: {
    organizationId: string;
    inviteId: string;
  }): Promise<{ expiresAtMs: number | null }>;
  extend(input: {
    organizationId: string;
    inviteId: string;
  }): Promise<{ expiresAtMs: number | null }>;
}

export interface IdentityLookupAnswer {
  /** What the operator typed, kept verbatim so the screen can show both. */
  typed: string;
  /** What the auth screens' own normalization makes of it. */
  resolved: string;
  domain: string | null;
  routing: LookupRouting;
  people: readonly LookupPerson[];
}

export interface LookupRouting {
  outcome: string;
  reasonCode: string;
  connectionId: string | null;
  /** What the auth screens would offer, by method id. */
  methods: readonly string[];
  /** The connection owning the domain and the state it is in, named beside
   *  the decision so the reason and its cause are read together. */
  connection: {
    connectionId: string;
    organizationId: string;
    organizationName: string | null;
    state: string;
    providerId: string;
  } | null;
}

export interface LookupPerson {
  userId: string;
  name: string | null;
  email: string | null;
  organizations: readonly {
    organizationId: string;
    name: string | null;
    role: string;
  }[];
  /** How this person holds the address that was looked up. */
  holding: readonly LookupIdentifier[];
}

export interface LookupIdentifier {
  identifierId: string;
  provider: string;
  value: string | null;
  domain: string | null;
  state: string;
  connectionId: string | null;
  /** What proved it: the state says whether anything did, and this says by
   *  which method — the two together are "what proved it and when". */
  verifiedAtMs: number | null;
  attachedAtMs: number;
  /** When it stopped counting, if it has. */
  detachedAtMs: number | null;
}

export interface LookupPersonDetail {
  person: LookupPerson;
  identifiers: readonly LookupIdentifier[];
  waiting: LookupWaiting;
  history: readonly IdentityHistoryEntry[];
  sessions: readonly {
    sessionId: string;
    identifierId: string | null;
    createdAtMs: number;
    expiresAtMs: number;
  }[];
}

export interface LookupWaiting {
  proposals: readonly LinkProposalRecord[];
  invitations: readonly LookupInvitation[];
  domainClaims: readonly LookupDomainClaim[];
  /** True when nothing at all is waiting, so the panel can collapse to one
   *  line rather than render three empty sections saying so. */
  isEmpty: boolean;
}

export interface LookupInvitation {
  inviteId: string;
  email: string;
  organizationId: string;
  organizationName: string | null;
  invitedByName: string | null;
  status: string;
  expiresAtMs: number | null;
  /** Derived, never stored: a pending invitation past its expiry IS expired
   *  (D11), and one that looked live here would send an operator to resend
   *  something that already works. */
  isExpired: boolean;
}

export interface LookupDomainClaim {
  connectionId: string;
  organizationId: string;
  organizationName: string | null;
  domain: string;
  waitingSinceMs: number;
}

export interface IdentityLookupServiceDeps {
  reads: IdentityLookupReadsRepository;
  history: IdentityHistoryReadsRepository;
  proposals: LinkProposalReadsRepository;
  router: () => SignInRouterService;
  identity: () => IdentityService;
  links: () => LinkProposalService;
  sessions: OperatorSessionPort;
  invitations: OperatorInvitationPort;
  /** Wall clock, injected so "is this invitation expired" is testable. */
  now?: () => number;
}

/**
 * The platform operator's identity lookup (D05).
 *
 * One address in, and every panel a support case needs out. Two properties
 * hold it together and neither is decoration:
 *
 * The routing panel calls the AUTH SCREENS' OWN router. Not a copy of its
 * rules, not a re-read of the same tables — `SignInRouterService.route`, the
 * function the sign-in screen calls, so the answer on this page cannot drift
 * from the answer the person got. A second implementation would be wrong on
 * exactly the day somebody needed it to be right.
 *
 * Every repair is a guarded command. This class mints command ids and stamps
 * the operator as the actor; the guards decide. There is no branch here that
 * reproduces a rule the guards already hold — most visibly the strands
 * refusal, which this surface RENDERS and never inspects: an operator
 * detaching somebody's last way in is refused by `detachIdentifier`, and the
 * surface's job is to say so in words, not to pre-empt it with a check that
 * could disagree.
 */
export class IdentityLookupService {
  private readonly deps: IdentityLookupServiceDeps;
  private readonly now: () => number;

  constructor(deps: IdentityLookupServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /**
   * Resolve one address across every organization on the installation.
   *
   * An address nobody holds answers with the routing decision and an empty
   * people list — the same shape a found one answers with. It is not an
   * error, and it must not look like one: "nobody holds it" is an answer to
   * the question a support case asked.
   */
  async resolve({
    address,
  }: {
    address: string;
  }): Promise<IdentityLookupAnswer> {
    const routingIdentifier = routingIdentifierOf(address);
    const resolved = routingIdentifier.normalized;

    const decision = await this.deps.router().route({ identifier: address });
    const connection = routingIdentifier.domain
      ? await this.deps.reads.findConnectionForDomain({
          domain: routingIdentifier.domain,
        })
      : null;

    const identifiers = await this.deps.reads.findIdentifiersByValue({
      value: resolved,
    });
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

  /** One person, with every panel the drawer renders. */
  async person({
    userId,
    address,
  }: {
    userId: string;
    address: string;
  }): Promise<LookupPersonDetail | null> {
    const identifierRows = await this.deps.reads.findIdentifiersForUser({
      userId,
    });
    const [people, history, sessions] = await Promise.all([
      this.assemblePeople({
        identifiers: identifierRows.filter(
          (row) => row.value === normalizeIdentifierValue(address),
        ),
        fallbackUserIds: [userId],
      }),
      this.deps.history.findHistory({
        userId,
        limit: IDENTITY_LOOKUP_HISTORY_LIMIT,
      }),
      this.deps.reads.findSessions({ userId }),
    ]);
    const person = people[0];
    if (!person) return null;

    return {
      person,
      identifiers: identifierRows.map(toLookupIdentifier),
      waiting: await this.waitingFor({ person, identifiers: identifierRows }),
      history,
      sessions,
    };
  }

  /**
   * What operators have done on this surface recently.
   *
   * Read off the SAME audit trail the repairs write to — the reads and the
   * writes are rows in one table under one action prefix, so "who looked
   * this person up" and "who repaired them" are answered by one query in one
   * order. A separate trail for reads would be the second record nobody
   * reconciles.
   */
  async recentActivity(): Promise<readonly LookupOperatorActivityRow[]> {
    return this.deps.reads.findRecentOperatorActivity({
      limit: OPERATOR_ACTIVITY_LIMIT,
    });
  }

  /** The claims queue, longest wait first. */
  async claimQueue(): Promise<readonly LookupDomainClaim[]> {
    const rows = await this.deps.reads.findClaimQueue({
      limit: DOMAIN_CLAIM_QUEUE_LIMIT,
    });
    return this.nameOrganizations({ claims: rows });
  }

  async confirmProposedSignIn({
    userId,
    proposalId,
    operator,
  }: {
    userId: string;
    proposalId: string;
    operator: OperatorActor;
  }): Promise<void> {
    await this.deps.links().confirmLink({
      ...this.identityCommand({ userId, operator }),
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
    operator: OperatorActor;
  }): Promise<void> {
    await this.deps.links().rejectLink({
      ...this.identityCommand({ userId, operator }),
      proposalId,
    });
  }

  /**
   * Detach a sign-in method.
   *
   * Straight through to the guard, which refuses to strand somebody. There
   * is deliberately no pre-check here: a surface that decided for itself
   * whether a detach would strand would be a second copy of the rule, and
   * the second copy is the one that goes stale.
   */
  async detachMethod({
    userId,
    identifierId,
    operator,
  }: {
    userId: string;
    identifierId: string;
    operator: OperatorActor;
  }): Promise<void> {
    await this.deps.identity().detachIdentifier({
      ...this.identityCommand({ userId, operator }),
      identifierId,
    });
  }

  async endSessions({
    userId,
    identifierId,
  }: {
    userId: string;
    /** Null ends every session this person holds; an id ends only the ones
     *  that method minted. */
    identifierId: string | null;
  }): Promise<void> {
    if (identifierId === null) {
      await this.deps.sessions.endAllForUser({ userId });
      return;
    }
    await this.deps.sessions.endForIdentifier({ userId, identifierId });
  }

  async resendInvitation({
    organizationId,
    inviteId,
  }: {
    organizationId: string;
    inviteId: string;
  }): Promise<{ expiresAtMs: number | null }> {
    return this.deps.invitations.resend({ organizationId, inviteId });
  }

  async extendInvitation({
    organizationId,
    inviteId,
  }: {
    organizationId: string;
    inviteId: string;
  }): Promise<{ expiresAtMs: number | null }> {
    return this.deps.invitations.extend({ organizationId, inviteId });
  }

  /**
   * The identity block every repair carries.
   *
   * `tenantId` is the SUBJECT's user id, never the operator's: one history
   * per person is the aggregate's invariant, and an operator acting on
   * somebody's identity writes into that person's history. The operator is
   * on the `actor`, which is exactly where "who did this" belongs.
   */
  private identityCommand({
    userId,
    operator,
  }: {
    userId: string;
    operator: OperatorActor;
  }): {
    tenantId: string;
    userId: string;
    commandId: string;
    occurredAtMs: number;
    actor: IdentityActor;
  } {
    return {
      tenantId: userId,
      userId,
      commandId: newIdentityCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "user", id: operator.userId },
    };
  }

  private async assemblePeople({
    identifiers,
    fallbackUserIds = [],
  }: {
    identifiers: readonly LookupIdentifierRow[];
    fallbackUserIds?: readonly string[];
  }): Promise<readonly LookupPerson[]> {
    const userIds = [
      ...new Set([...identifiers.map((row) => row.userId), ...fallbackUserIds]),
    ];
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
      holding: identifiers
        .filter((row) => row.userId === userId)
        .map(toLookupIdentifier),
    }));
  }

  private async waitingFor({
    person,
    identifiers,
  }: {
    person: LookupPerson;
    identifiers: readonly LookupIdentifierRow[];
  }): Promise<LookupWaiting> {
    const domains = [
      ...new Set(
        identifiers
          .map((row) => row.domain)
          .filter((domain): domain is string => domain !== null),
      ),
    ];
    const [proposals, invitationRows, claimRows] = await Promise.all([
      this.deps.proposals.findProposals({ userId: person.userId }),
      person.email
        ? this.deps.reads.findInvitations({ email: person.email })
        : Promise.resolve([]),
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
      isEmpty:
        undecided.length === 0 &&
        invitations.length === 0 &&
        domainClaims.length === 0,
    };
  }

  /**
   * Claims arrive named by organization id alone; an operator confirming an
   * action against `org_LVYcVYGW1AJq` has been told nothing they can check.
   * Resolved in one batched read rather than a join per row.
   */
  private async nameOrganizations({
    claims,
  }: {
    claims: readonly LookupDomainClaimRow[];
  }): Promise<readonly LookupDomainClaim[]> {
    if (claims.length === 0) return [];
    const named = await this.deps.reads.findOrganizationNames({
      organizationIds: claims.map((claim) => claim.organizationId),
    });
    return claims.map((claim) => ({
      connectionId: claim.connectionId,
      organizationId: claim.organizationId,
      organizationName:
        claim.organizationName ?? named.get(claim.organizationId) ?? null,
      domain: claim.domain,
      waitingSinceMs: claim.waitingSinceMs,
    }));
  }
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
