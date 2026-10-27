/**
 * `identity.joinRequests.*` as identity serves it: the caller's own verified
 * address resolved once, folded ledger state turned into the two screen shapes,
 * the requester's address withheld from the organization until membership.
 */

import {
  type IdentityDomainAdmission,
  type JoinAdmissionsApi,
  type JoinLookupDecision,
  type JoinRequestAdmitted,
  type JoinRequestAggregateState,
  type JoinRequestApiOrigin,
  type JoinRequestAutomaticJoins,
  type JoinRequestFiled,
  type JoinRequestJoining,
  type JoinRequestJoiningChanged,
  type JoinRequestMine,
  type JoinRequestPending,
  type JoinRequestsApi,
  type VerifiedEmailsResolution,
  seatForJoiner,
} from "@langwatch/identity-contract";
import { Temporal, toDate } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

/** Shown where the ledger knows a requester's id but nobody's name. */
const UNNAMED_COLLEAGUE = "A colleague";

interface JoinRequestDoorDependencies {
  readonly joinRequests: JoinRequestsApi;
  readonly admissions: JoinAdmissionsApi;
  readonly emails: {
    verifiedEmailsOf(input: { userId: string }): Promise<VerifiedEmailsResolution>;
  };
  /** Display names, and the legacy verified address of somebody not on identifiers yet. */
  readonly users: Pick<UserApi, "getProfiles">;
}

export class JoinRequestDoorService {
  static create(dependencies: JoinRequestDoorDependencies): JoinRequestDoorService {
    return new JoinRequestDoorService(dependencies);
  }

  private constructor(private readonly deps: JoinRequestDoorDependencies) {}

  /** Every closed door (unverified, consumer domain, joining off, nonexistent) answers alike. */
  async lookup(input: Readonly<{ userId: string }>): Promise<JoinLookupDecision> {
    return this.deps.joinRequests.lookup({
      userId: input.userId,
      verifiedEmail: await this.findVerifiedEmail(input),
    });
  }

  /** The post-login offer: the same answer, minus the domains they dismissed. */
  async offer(input: Readonly<{ userId: string }>): Promise<JoinLookupDecision> {
    return this.deps.joinRequests.offerForSignedInUser({
      userId: input.userId,
      verifiedEmail: await this.findVerifiedEmail(input),
    });
  }

  /** "No thanks", remembered for the caller's own verified domain. */
  async dismissOffer(input: Readonly<{ userId: string }>): Promise<void> {
    await this.deps.joinRequests.dismissOffer({
      userId: input.userId,
      verifiedEmail: await this.findVerifiedEmail(input),
    });
  }

  /** Walk in where the organization asked for that; a null organization is the ordinary case. */
  async admitAutomatically(
    input: Readonly<{ userId: string; origin?: JoinRequestApiOrigin }>,
  ): Promise<JoinRequestAdmitted> {
    return this.deps.joinRequests.joinAutomaticallyIfAdmitted({
      userId: input.userId,
      verifiedEmail: await this.findVerifiedEmail(input),
      ...(input.origin === undefined ? {} : { origin: input.origin }),
    });
  }

  /** Who walked in on the domain setting lately, named for the members area. */
  async listAutomaticJoins(
    input: Readonly<{ organizationId: string }>,
  ): Promise<JoinRequestAutomaticJoins> {
    const joins = await this.deps.joinRequests.automaticJoinsForOrganization(input);
    const nameById = await this.namesOf(joins.map((join) => join.userId));

    return joins.map((join) => ({
      joinRequestId: join.joinRequestId,
      userId: join.userId,
      name: nameById.get(join.userId) ?? UNNAMED_COLLEAGUE,
      domain: join.domain,
      joinedAt:
        join.resolvedAtMs === null
          ? null
          : toDate(Temporal.Instant.fromEpochMilliseconds(join.resolvedAtMs)),
    }));
  }

  /** Everything this person is waiting on. */
  async listOwn(input: Readonly<{ userId: string }>): Promise<JoinRequestMine> {
    const pending = await this.deps.joinRequests.pendingForUser(input);

    return pending.map((request) => ({
      ...waitingSince(request),
      organizationId: request.organizationId,
    }));
  }

  async file(
    input: Readonly<{ userId: string; organizationId: string; origin?: JoinRequestApiOrigin }>,
  ): Promise<JoinRequestFiled> {
    return this.deps.joinRequests.request({
      userId: input.userId,
      verifiedEmail: await this.findVerifiedEmail({ userId: input.userId }),
      organizationId: input.organizationId,
      ...(input.origin === undefined ? {} : { origin: input.origin }),
    });
  }

  withdraw(input: Readonly<{ joinRequestId: string; userId: string }>): Promise<void> {
    return this.deps.joinRequests.withdraw(input);
  }

  /**
   * What is waiting on this organization. Who is asking, by name: the local
   * part of a requester's address is not the organization's business until
   * they are a member of it.
   */
  async listPending(input: Readonly<{ organizationId: string }>): Promise<JoinRequestPending> {
    const pending = await this.deps.joinRequests.pendingForOrganization(input);
    const { joinerRole } = await this.deps.joinRequests.readJoining(input);
    const nameById = await this.namesOf(pending.map((request) => request.userId));

    return pending.map((request) => ({
      ...waitingSince(request),
      userId: request.userId,
      name: nameById.get(request.userId) ?? UNNAMED_COLLEAGUE,
      domain: request.domain,
      seat: seatForJoiner({ origin: request.origin, joinerRole }),
    }));
  }

  approve(
    input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>,
  ): Promise<void> {
    return this.deps.joinRequests.approve(input);
  }

  reject(
    input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>,
  ): Promise<void> {
    return this.deps.joinRequests.reject(input);
  }

  readJoining(input: Readonly<{ organizationId: string }>): Promise<JoinRequestJoining> {
    return this.deps.joinRequests.readJoining(input);
  }

  /** Audited by the ledger against the administrator who saved it. */
  async setJoining(
    input: Readonly<{
      organizationId: string;
      domainJoin: JoinRequestJoining["domainJoin"];
      domains: readonly string[];
      joinerRole?: JoinRequestJoining["joinerRole"];
      actorUserId: string;
    }>,
  ): Promise<JoinRequestJoiningChanged> {
    const change = await this.deps.joinRequests.setJoining(input);

    return {
      previous: change.previous,
      next: change.next,
      previousDomains: [...change.previousDomains],
      nextDomains: [...change.nextDomains],
      previousJoinerRole: change.previousJoinerRole,
      nextJoinerRole: change.nextJoinerRole,
    };
  }

  /** Which of these members a matching domain admitted; nobody outside the list is answered. */
  findAdmissions(
    input: Readonly<{ organizationId: string; userIds: readonly string[] }>,
  ): Promise<IdentityDomainAdmission[]> {
    return this.deps.admissions.findForMembers(input);
  }

  /**
   * The caller's own first PROVEN address: identifiers first, else the legacy
   * column only where it was verified.
   */
  private async findVerifiedEmail({
    userId,
  }: Readonly<{ userId: string }>): Promise<string | null> {
    const verified = await this.deps.emails.verifiedEmailsOf({ userId });
    if (verified.kind === "resolved") return verified.emails[0]?.value ?? null;
    const [profile] = await this.deps.users.getProfiles({ userIds: [userId] });
    return profile?.emailVerified ? profile.email : null;
  }

  private async namesOf(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const profiles = await this.deps.users.getProfiles({ userIds: [...new Set(userIds)] });
    return new Map(
      profiles.flatMap((person) =>
        person.name === null ? [] : [[person.id, person.name] as const],
      ),
    );
  }
}

/** One waiting request, as both pending lists render it. */
function waitingSince(
  request: JoinRequestAggregateState,
): Omit<JoinRequestMine[number], "organizationId"> {
  return {
    joinRequestId: request.joinRequestId,
    requestedAt: toDate(Temporal.Instant.fromEpochMilliseconds(request.createdAtMs)),
    expiresAt:
      request.expiresAtMs === null
        ? null
        : toDate(Temporal.Instant.fromEpochMilliseconds(request.expiresAtMs)),
  };
}
