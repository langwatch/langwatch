import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  DOMAIN_AUTO_JOIN_POLICY_ID,
  type DomainJoinSetting,
  isPublicEmailDomain,
  JOIN_AUTO_VERIFIED_MEMBER_THRESHOLD,
  JoinAutoConnectionAdmitsError,
  JoinAutoDomainUnprovenError,
  JoinAutoNotLicensedError,
  type JoinLookupDecision,
  JoinNotAvailableError,
  type JoinOffer,
  type JoinRequestAggregateState,
  JoinRequestNotFoundError,
  JoinRequestThrottledError,
  joinDomainOf,
  normalizeDomain,
  organizationAdmitsDomain,
  resolveJoinLookup,
} from "@langwatch/identity-contract";
import type { JoinCandidateRepository } from "../join-request.repository";
import type { JoinRequestService } from "../join-request.service";
import {
  approveJoinCommandId,
  newJoinRequestCommandId,
  newJoinRequestId,
} from "../join-request-id";
import { createLogger } from "@langwatch/observability";
import { JOIN_REQUEST_EXPIRY_MS } from "../processes/join-request-lifecycle.process";
import type { PrismaJoinRequestReadRepository } from "../repositories/prisma/prisma.join-request.repository";

const logger = createLogger("langwatch:identity:join-requests");

/**
 * How often somebody may ask, and how often they may look. The sign-in
 * endpoints' own shape (`frontDoor.ts`): a per-actor sliding window, generous
 * enough that nobody legitimate meets it and tight enough that volume is not
 * free. A request costs an admin attention, which is the thing being
 * protected here.
 */
export const JOIN_REQUEST_RATE_WINDOW_SECONDS = 60 * 60;
export const JOIN_REQUESTS_PER_WINDOW = 5;
export const JOIN_LOOKUPS_PER_WINDOW = 60;

/**
 * How long a rejected person waits before asking the same organization again.
 *
 * Seven days, and refused with the THROTTLE code rather than a rejection
 * code, deliberately: a refusal that said "you were rejected" would hand back
 * the very thing the silent-ish rejection keeps quiet, and an admin who says
 * no should not have to say it again next morning.
 */
export const JOIN_REJECTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** What an organization's admins are told, and by what means. Injected so
 *  the mail is the app's business and this service stays testable. */
export interface JoinRequestNotifier {
  requestArrived(args: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
    domain: string;
  }): Promise<void>;
  requestStillWaiting(args: {
    joinRequestId: string;
    organizationId: string;
  }): Promise<void>;
  requestApproved(args: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<void>;
  requestRejected(args: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<void>;
  requestExpired(args: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<void>;
  joinedAutomatically(args: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
    domain: string;
  }): Promise<void>;
}

/** How a membership actually lands: the same ledger an invitation uses. */
export interface JoinMembershipPort {
  attachDefaultMembership(args: {
    userId: string;
    organizationId: string;
    /** The approving admin, or nobody when the policy approved. */
    approvedByUserId: string | null;
  }): Promise<void>;
  isMember(args: { userId: string; organizationId: string }): Promise<boolean>;
}

/** Whether this organization may change its joining setting, and to what. */
export interface JoinSettingPort {
  read(args: {
    organizationId: string;
  }): Promise<{ domainJoin: DomainJoinSetting; joinDomains: string[] }>;
  write(args: {
    organizationId: string;
    domainJoin: DomainJoinSetting;
    joinDomains: string[];
  }): Promise<void>;
}

export interface JoinRequestsServiceDeps {
  requests: JoinRequestService;
  reads: PrismaJoinRequestReadRepository;
  candidates: JoinCandidateRepository;
  membership: JoinMembershipPort;
  notifier: JoinRequestNotifier;
  settings: JoinSettingPort;
  /** The licence gate. Holds `auto`, lets `request` through. */
  autoJoinLicensed: () => Promise<boolean>;
  /** Whether any of this exists at all. Flag off, nothing here runs. */
  enabled: (args: { userId: string }) => Promise<boolean>;
  /**
   * The shared counter behind the two throttles.
   *
   * The process's, not this service's: it is the same counter the sign-in
   * doors and the public REST surface meter through, and a second one here
   * would let somebody spend a budget twice by asking on two paths.
   */
  rateLimit: (input: {
    key: string;
    windowSeconds: number;
    max: number;
  }) => Promise<{ allowed: boolean; resetAt: number }>;
  now?: () => number;
}

/**
 * Join requests, as the app orchestrates them (D12, ADR-117).
 *
 * The event-sourced service owns the lifecycle; this owns everything around
 * it — which organizations a person may see, whether they are asking too
 * often, who is told, and how an approval becomes a membership. Three of
 * those are refusals a customer reads, so all three carry a stable code.
 *
 * The reveal discipline is the load-bearing part and it is enforced HERE
 * rather than in the UI: a lookup answers only for an address the caller has
 * verified, a request is refused for an organization that was not offered,
 * and every closed door answers `join_not_available`. Telling those apart is
 * the leak.
 */
export class JoinRequestsService {
  private readonly deps: JoinRequestsServiceDeps;
  private readonly now: () => number;

  constructor(deps: JoinRequestsServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Which organizations are open to one of the caller's OWN verified
   * addresses.
   *
   * The address is not an input a caller chooses freely: it is handed in
   * having already been proved to belong to them, which is what makes this
   * safe to answer at all. An unverified address gets the same nothing a
   * domain nobody holds gets.
   */
  async lookup({
    userId,
    verifiedEmail,
  }: {
    userId: string;
    verifiedEmail: string | null;
  }): Promise<JoinLookupDecision> {
    if (!(await this.deps.enabled({ userId }))) return { outcome: "none" };
    if (!verifiedEmail) return { outcome: "none" };

    const domain = joinDomainOf(verifiedEmail);
    if (!domain || isPublicEmailDomain(domain)) return { outcome: "none" };

    await this.assertNotLooking({ userId });

    const organizations = await this.deps.candidates.findCandidateOrganizations(
      { domain },
    );
    const decision = resolveJoinLookup({
      email: verifiedEmail,
      verified: true,
      organizations,
      autoJoinLicensed: await this.deps.autoJoinLicensed(),
    });

    // The domain and the decision, never the local part: a log line that
    // carried the address would be a directory of who works where written by
    // us, in a place we keep for ninety days.
    logger.info(
      { domain, outcome: decision.outcome },
      "join lookup answered for a verified domain",
    );
    return decision;
  }

  /**
   * Ask one organization to let you in.
   *
   * The organization has to have been OFFERED — the service re-derives that
   * from the caller's verified address rather than trusting the client, so
   * naming an organization directly is refused exactly as an organization
   * that does not exist is.
   */
  async request({
    userId,
    verifiedEmail,
    organizationId,
  }: {
    userId: string;
    verifiedEmail: string | null;
    organizationId: string;
  }): Promise<{ joinRequestId: string; state: "PENDING" | "APPROVED" }> {
    if (!(await this.deps.enabled({ userId }))) {
      throw new JoinNotAvailableError("join requests are not enabled here");
    }
    const domain = this.provenDomainOrRefuse({ verifiedEmail });
    const candidate = await this.deps.candidates.tryFindCandidateOrganization({
      organizationId,
      domain,
    });
    if (
      !candidate ||
      !organizationAdmitsDomain({ organization: candidate, domain })
    ) {
      // The same refusal an organization that does not exist produces.
      throw new JoinNotAvailableError(
        `organization ${organizationId} is not open to ${domain}`,
      );
    }

    await this.assertNotAsking({ userId, organizationId });
    await this.assertNotInCoolDown({ userId, organizationId });

    const joinRequestId = newJoinRequestId();
    const occurredAtMs = this.now();
    await this.deps.requests.requestJoin({
      tenantId: organizationId,
      organizationId,
      joinRequestId,
      commandId: newJoinRequestCommandId(),
      occurredAtMs,
      actor: { type: "user", id: userId },
      userId,
      domain,
      matchedVia: "verified-identifier-domain",
      expiresAtMs: occurredAtMs + JOIN_REQUEST_EXPIRY_MS,
    });

    await this.deps.notifier.requestArrived({
      joinRequestId,
      organizationId,
      requesterUserId: userId,
      domain,
    });
    return { joinRequestId, state: "PENDING" };
  }

  /**
   * The automatic path. NOT a second mechanism: the same request, the same
   * events, the same panel and the same audit trail — approved by policy the
   * moment it is made instead of by a person later.
   *
   * Returns null when nothing admits this address automatically, which is the
   * ordinary case and not a failure.
   */
  async joinAutomaticallyIfAdmitted({
    userId,
    verifiedEmail,
  }: {
    userId: string;
    verifiedEmail: string | null;
  }): Promise<{ organization: JoinOffer } | null> {
    const decision = await this.lookup({ userId, verifiedEmail });
    if (decision.outcome !== "auto") return null;

    const domain = joinDomainOf(verifiedEmail ?? "");
    if (!domain) return null;

    const organizationId = decision.organization.organizationId;
    const joinRequestId = newJoinRequestId();
    const occurredAtMs = this.now();
    const policyActor = {
      type: "system" as const,
      id: SYSTEM_ACTORS.joinRequests,
    };

    await this.deps.requests.requestJoin({
      tenantId: organizationId,
      organizationId,
      joinRequestId,
      commandId: newJoinRequestCommandId(),
      occurredAtMs,
      actor: policyActor,
      userId,
      domain,
      matchedVia: "verified-identifier-domain",
      expiresAtMs: occurredAtMs + JOIN_REQUEST_EXPIRY_MS,
    });

    await this.resolveApproved({
      joinRequestId,
      organizationId,
      userId,
      resolvedBy: { type: "policy", id: DOMAIN_AUTO_JOIN_POLICY_ID },
      actor: policyActor,
      approvedByUserId: null,
      occurredAtMs,
    });

    // After the fact, straight away: a surprising join has to be visible the
    // moment it happens, which is the whole price of admitting somebody with
    // nobody in the loop.
    await this.deps.notifier.joinedAutomatically({
      joinRequestId,
      organizationId,
      requesterUserId: userId,
      domain,
    });
    return { organization: decision.organization };
  }

  /** An admin says yes. There is no role on this call and never will be. */
  async approve({
    joinRequestId,
    organizationId,
    adminUserId,
  }: {
    joinRequestId: string;
    organizationId: string;
    adminUserId: string;
  }): Promise<void> {
    const request = await this.ownedRequestOrRefuse({
      joinRequestId,
      organizationId,
    });
    await this.resolveApproved({
      joinRequestId,
      organizationId,
      userId: request.userId,
      resolvedBy: { type: "user", id: adminUserId },
      actor: { type: "user", id: adminUserId },
      approvedByUserId: adminUserId,
      occurredAtMs: this.now(),
    });
    await this.deps.notifier.requestApproved({
      joinRequestId,
      organizationId,
      requesterUserId: request.userId,
    });
  }

  /** An admin says no, without being asked why. */
  async reject({
    joinRequestId,
    organizationId,
    adminUserId,
  }: {
    joinRequestId: string;
    organizationId: string;
    adminUserId: string;
  }): Promise<void> {
    const request = await this.ownedRequestOrRefuse({
      joinRequestId,
      organizationId,
    });
    await this.deps.requests.rejectJoin({
      tenantId: organizationId,
      organizationId,
      joinRequestId,
      commandId: newJoinRequestCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "user", id: adminUserId },
      resolvedBy: { type: "user", id: adminUserId },
    });
    // No reason, and no rejector named. The requester is told it was not
    // approved and may ask again after the cool-down.
    await this.deps.notifier.requestRejected({
      joinRequestId,
      organizationId,
      requesterUserId: request.userId,
    });
  }

  /** The requester giving up, so nobody is bothered further. */
  async withdraw({
    joinRequestId,
    userId,
  }: {
    joinRequestId: string;
    userId: string;
  }): Promise<void> {
    const request = await this.deps.reads.findRequest({ joinRequestId });
    if (!request || request.userId !== userId) {
      throw new JoinRequestNotFoundError(
        `join request ${joinRequestId} is not ${userId}'s to withdraw`,
      );
    }
    await this.deps.requests.withdrawJoin({
      tenantId: request.organizationId,
      organizationId: request.organizationId,
      joinRequestId,
      commandId: newJoinRequestCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "user", id: userId },
      cause: "user",
    });
  }

  /**
   * D11 crossing point, invitation → request: sending a formal invitation to
   * somebody with an open request ANSWERS it. The invitation carries the role
   * and the teams, which is the flow that owns them.
   *
   * Silent when there is nothing open — an invitation is never blocked by a
   * request, in either direction.
   */
  async resolveByInvitation({
    userId,
    organizationId,
    inviteId,
  }: {
    userId: string;
    organizationId: string;
    inviteId: string;
  }): Promise<void> {
    const open = await this.deps.reads.findPendingRequest({
      userId,
      organizationId,
    });
    if (!open) return;
    await this.deps.requests.approveJoin({
      tenantId: organizationId,
      organizationId,
      joinRequestId: open.joinRequestId,
      commandId: approveJoinCommandId({
        joinRequestId: open.joinRequestId,
        resolvedByType: "invite",
        resolvedById: inviteId,
      }),
      occurredAtMs: this.now(),
      actor: { type: "system", id: SYSTEM_ACTORS.joinRequests },
      resolvedBy: { type: "invite", id: inviteId },
    });
    // No membership attach here: the invitation's own acceptance does that,
    // with the role and teams IT carries. This only closes the request so a
    // person never holds both.
  }

  /**
   * D11 crossing point, acceptance → request: accepting any invitation
   * withdraws the same person's open request for that organization, so the
   * membership lands exactly once and the admins' panel empties itself.
   */
  async withdrawOnInvitationAccepted({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const open = await this.deps.reads.findPendingRequest({
      userId,
      organizationId,
    });
    if (!open) return;
    await this.deps.requests.withdrawJoin({
      tenantId: organizationId,
      organizationId,
      joinRequestId: open.joinRequestId,
      commandId: newJoinRequestCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "system", id: SYSTEM_ACTORS.joinRequests },
      cause: "invite-accepted",
    });
  }

  /**
   * Turn automatic joining on, off, or back to asking.
   *
   * Three refusals, in the order that costs the customer least to fix: the
   * licence, then the identity provider that already admits people, then the
   * domain nobody has proved.
   */
  async setJoining({
    organizationId,
    domainJoin,
    domains,
  }: {
    organizationId: string;
    domainJoin: DomainJoinSetting;
    domains: readonly string[];
  }): Promise<{ previous: DomainJoinSetting; next: DomainJoinSetting }> {
    const current = await this.deps.settings.read({ organizationId });
    const normalized = domains.map(normalizeDomain).filter(Boolean);

    if (domainJoin === "auto") {
      if (!(await this.deps.autoJoinLicensed())) {
        throw new JoinAutoNotLicensedError(
          `organization ${organizationId} cannot enable automatic joining without a genuine license`,
        );
      }
      if (normalized.length === 0) {
        throw new JoinAutoDomainUnprovenError(
          "automatic joining needs a company domain to be named",
        );
      }
      for (const domain of normalized) {
        await this.assertDomainProven({ organizationId, domain });
      }
    }

    await this.deps.settings.write({
      organizationId,
      domainJoin,
      // Turning automatic joining off clears the domains it named: a setting
      // flipped back on later must name them again, deliberately, rather than
      // inherit a list from a decision somebody made months ago.
      joinDomains: domainJoin === "auto" ? normalized : [],
    });
    return { previous: current.domainJoin, next: domainJoin };
  }

  /** How this organization has set joining, for the settings card. */
  async readJoining({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ domainJoin: DomainJoinSetting; joinDomains: string[] }> {
    return this.deps.settings.read({ organizationId });
  }

  /** What is waiting on this organization. */
  async pendingForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<JoinRequestAggregateState[]> {
    return this.deps.reads.findPendingForOrganization({ organizationId });
  }

  /** What this person is waiting on. */
  async pendingForUser({
    userId,
  }: {
    userId: string;
  }): Promise<JoinRequestAggregateState[]> {
    return this.deps.reads.findPendingForUser({ userId });
  }

  /**
   * The approval's two halves: state the fact, then attach the membership.
   *
   * They are separate on purpose and in this order. The fact is durable
   * before anything else happens, and the attach is idempotent, so a crash
   * between them leaves a request that says APPROVED and a retry that
   * finishes the job — rather than a membership nobody can account for.
   *
   * Approving somebody who is ALREADY a member — because an invitation landed
   * while the request was open — resolves the request and adds nothing: the
   * attach is skipped rather than duplicated.
   */
  private async resolveApproved({
    joinRequestId,
    organizationId,
    userId,
    resolvedBy,
    actor,
    approvedByUserId,
    occurredAtMs,
  }: {
    joinRequestId: string;
    organizationId: string;
    userId: string;
    resolvedBy: { type: "user" | "policy" | "invite"; id: string };
    actor: { type: "user" | "system"; id: string };
    approvedByUserId: string | null;
    occurredAtMs: number;
  }): Promise<void> {
    await this.deps.requests.approveJoin({
      tenantId: organizationId,
      organizationId,
      joinRequestId,
      // Derived, not minted: a retry after a partial failure has to be the
      // SAME command, or it would state a second approval on a request that
      // already has one.
      commandId: approveJoinCommandId({
        joinRequestId,
        resolvedByType: resolvedBy.type,
        resolvedById: resolvedBy.id,
      }),
      occurredAtMs,
      actor,
      resolvedBy,
    });

    if (await this.deps.membership.isMember({ userId, organizationId })) {
      logger.info(
        { joinRequestId, organizationId },
        "join request approved for somebody who was already a member; no second membership attached",
      );
      return;
    }
    await this.deps.membership.attachDefaultMembership({
      userId,
      organizationId,
      approvedByUserId,
    });
  }

  /** The request, if this organization has one by that id. A request from
   *  somewhere else is answered as if it did not exist. */
  private async ownedRequestOrRefuse({
    joinRequestId,
    organizationId,
  }: {
    joinRequestId: string;
    organizationId: string;
  }): Promise<JoinRequestAggregateState> {
    const request = await this.deps.reads.findRequest({ joinRequestId });
    if (!request || request.organizationId !== organizationId) {
      throw new JoinRequestNotFoundError(
        `join request ${joinRequestId} does not belong to ${organizationId}`,
      );
    }
    return request;
  }

  /** The domain the caller has PROVED, or the universal nothing. */
  private provenDomainOrRefuse({
    verifiedEmail,
  }: {
    verifiedEmail: string | null;
  }): string {
    const domain = verifiedEmail ? joinDomainOf(verifiedEmail) : null;
    if (!domain || isPublicEmailDomain(domain)) {
      throw new JoinNotAvailableError(
        "no verified company address is available for this request",
      );
    }
    return domain;
  }

  private async assertNotAsking({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const limit = await this.deps.rateLimit({
      key: `joinRequests.request:${userId}`,
      windowSeconds: JOIN_REQUEST_RATE_WINDOW_SECONDS,
      max: JOIN_REQUESTS_PER_WINDOW,
    });
    if (!limit.allowed) {
      throw new JoinRequestThrottledError(retryAfterSeconds(limit.resetAt));
    }
    logger.debug(
      { organizationId },
      "join request rate limit checked for an asking user",
    );
  }

  private async assertNotLooking({
    userId,
  }: {
    userId: string;
  }): Promise<void> {
    const limit = await this.deps.rateLimit({
      key: `joinRequests.lookup:${userId}`,
      windowSeconds: JOIN_REQUEST_RATE_WINDOW_SECONDS,
      max: JOIN_LOOKUPS_PER_WINDOW,
    });
    if (!limit.allowed) {
      throw new JoinRequestThrottledError(retryAfterSeconds(limit.resetAt));
    }
  }

  private async assertNotInCoolDown({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const rejectedAt = await this.deps.reads.tryFindLastRejectionAt({
      userId,
      organizationId,
    });
    if (!rejectedAt) return;
    const clearsAt = rejectedAt.getTime() + JOIN_REJECTION_COOLDOWN_MS;
    const now = this.now();
    if (now >= clearsAt) return;
    // The throttle code, not a rejection code: see the cool-down constant.
    throw new JoinRequestThrottledError(Math.ceil((clearsAt - now) / 1000));
  }

  /**
   * Automatic joining needs the administrator to have named the domain AND a
   * second verified member on it. One colleague with a company-looking
   * address at a small vendor is not evidence a company owns a domain.
   */
  private async assertDomainProven({
    organizationId,
    domain,
  }: {
    organizationId: string;
    domain: string;
  }): Promise<void> {
    if (isPublicEmailDomain(domain)) {
      // Company domains only — and the copy says so without listing what is
      // on the deny-list, because publishing it makes the refusal a way to
      // enumerate it.
      throw new JoinAutoDomainUnprovenError(
        `automatic joining refused for the public email domain ${domain}`,
      );
    }
    const candidate = await this.deps.candidates.tryFindCandidateOrganization({
      organizationId,
      domain,
    });
    if (candidate?.connectionAdmitsDomain) {
      throw new JoinAutoConnectionAdmitsError(
        `an active connection already admits ${domain} for ${organizationId}`,
      );
    }
    const verified = candidate?.verifiedMembersOnDomain ?? 0;
    if (verified < JOIN_AUTO_VERIFIED_MEMBER_THRESHOLD) {
      throw new JoinAutoDomainUnprovenError(
        `${domain} is held by ${verified} verified member(s) of ${organizationId}; automatic joining needs ${JOIN_AUTO_VERIFIED_MEMBER_THRESHOLD}`,
      );
    }
  }
}

/** What the screen says is left, from the limiter's own answer. */
function retryAfterSeconds(resetAt: number): number {
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
}
