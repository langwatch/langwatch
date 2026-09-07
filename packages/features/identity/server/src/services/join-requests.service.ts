import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  DOMAIN_AUTO_JOIN_POLICY_ID,
  type DomainJoinSetting,
  isPublicEmailDomain,
  JoinAutoDomainUnprovenError,
  JoinAutoNotLicensedError,
  type JoinLookupDecision,
  JoinNotAvailableError,
  type JoinOffer,
  type JoinRequestAggregateState,
  JoinRequestNotFoundError,
  joinDomainOf,
  normalizeDomain,
  organizationAdmitsDomain,
  resolveJoinLookup,
} from "@langwatch/identity-contract";
import type {} from "../repositories/join-request.repository.ts";
import type { JoinRequestService } from "./join-request.service.ts";
import {
  approveJoinCommandId,
  newJoinRequestCommandId,
  newJoinRequestId,
} from "../rules/join-request-id.rules.ts";
import { createLogger } from "@langwatch/observability";
import { JOIN_REQUEST_EXPIRY_MS } from "../processes/join-request-lifecycle.process.ts";
import { type JoinRequestsServiceDeps } from "../rules/join-requests-contract.rules.ts";
import { JoinRequestAdmissionGuardsService } from "./join-request-admission-guards.service.ts";
import { JoinDomainSettingService } from "./join-domain-setting.service.ts";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:identity:join-requests");

/**
 * The event-sourced service owns the lifecycle; this owns everything around it — which
 * organizations a person may see, whether they are asking too often, who is told,
 * Join requests, as the app orchestrates them (D12, ADR-117).
 */
export class JoinRequestsService {
  static create(deps: JoinRequestsServiceDeps): JoinRequestsService {
    return new JoinRequestsService(deps);
  }

  private readonly deps: JoinRequestsServiceDeps;

  private readonly guards: JoinRequestAdmissionGuardsService;

  private readonly domainSetting: JoinDomainSettingService;

  private readonly now: () => number;

  private constructor(deps: JoinRequestsServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => nowInstant().epochMilliseconds);
    this.guards = JoinRequestAdmissionGuardsService.create(deps, this.now);
    this.domainSetting = JoinDomainSettingService.create(deps, this.guards);
  }

  /**
   * Which organizations are open to one of the caller's OWN verified addresses. The address is not
   * an input a caller chooses freely: it is handed in having already been proved to belong to them,
   * which is what makes this safe to answer at all.
   */
  async lookup({
    userId,
    verifiedEmail,
  }: {
    userId: string;
    verifiedEmail: string | null;
  }): Promise<JoinLookupDecision> {
    if (!(await this.deps.enabled({ userId }))) {
      return { outcome: "none" };
    }

    if (!verifiedEmail) {
      return { outcome: "none" };
    }

    const domain = joinDomainOf(verifiedEmail);
    if (!domain || isPublicEmailDomain(domain)) {
      return { outcome: "none" };
    }

    await this.guards.assertNotLooking({ userId });

    const organizations = await this.deps.candidates.findCandidateOrganizations({ domain });
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
   * Ask one organization to let you in. The organization has to have been OFFERED — the service re-
   * derives that from the caller's verified address rather than trusting the client, so naming an
   * organization directly is refused exactly as an organization that does not exist is.
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

    const domain = this.guards.provenDomainOrRefuse({ verifiedEmail });
    const candidate = await this.deps.candidates.tryFindCandidateOrganization({
      organizationId,
      domain,
    });
    if (!candidate || !organizationAdmitsDomain({ organization: candidate, domain })) {
      // The same refusal an organization that does not exist produces.
      throw new JoinNotAvailableError(`organization ${organizationId} is not open to ${domain}`);
    }

    await this.guards.assertNotAsking({ userId, organizationId });
    await this.guards.assertNotInCoolDown({ userId, organizationId });

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
   * The automatic path. NOT a second mechanism: the same request, the same events, the same panel
   * and the same audit trail — approved by policy the moment it is made instead of by a person
   * later.
   */
  async tryJoinAutomaticallyIfAdmitted({
    userId,
    verifiedEmail,
  }: {
    userId: string;
    verifiedEmail: string | null;
  }): Promise<{ organization: JoinOffer } | null> {
    const decision = await this.lookup({ userId, verifiedEmail });
    if (decision.outcome !== "auto") {
      return null;
    }

    const domain = joinDomainOf(verifiedEmail ?? "");
    if (!domain) {
      return null;
    }

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
    const request = await this.guards.ownedRequestOrRefuse({
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
    const request = await this.guards.ownedRequestOrRefuse({
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
    const request = await this.deps.reads.tryFindRequest({ joinRequestId });
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
   * D11 crossing point, invitation → request: sending a formal invitation to somebody with an open
   * request ANSWERS it. The invitation carries the role and the teams, which is the flow that owns
   * them.
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
    const open = await this.deps.reads.tryFindPendingRequest({
      userId,
      organizationId,
    });
    if (!open) {
      return;
    }

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
    const open = await this.deps.reads.tryFindPendingRequest({
      userId,
      organizationId,
    });
    if (!open) {
      return;
    }

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
   * Turn automatic joining on, off, or back to asking. Three refusals, in the order that costs
   * the customer least to fix: the licence, then the identity provider that already admits
   * people, then the domain nobody has proved.
   */
  setJoining(
    ...args: Parameters<JoinDomainSettingService["setJoining"]>
  ): ReturnType<JoinDomainSettingService["setJoining"]> {
    return this.domainSetting.setJoining(...args);
  }

  /** How this organization has set joining, for the settings card. */
  readJoining(
    ...args: Parameters<JoinDomainSettingService["readJoining"]>
  ): ReturnType<JoinDomainSettingService["readJoining"]> {
    return this.domainSetting.readJoining(...args);
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
  async pendingForUser({ userId }: { userId: string }): Promise<JoinRequestAggregateState[]> {
    return this.deps.reads.findPendingForUser({ userId });
  }

  /**
   * The approval's two halves: state the fact, then attach the membership. They are separate on
   * purpose and in this order.
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
}
