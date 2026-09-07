/**
 * Whether a person may ask at all: are they asking too often, looking too often, still inside
 * a rejection's cool-down, is the domain they claim actually held by the organization, and is
 * the request they name one this organization owns. Every refusal is thrown, never returned.
 */
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  JOIN_AUTO_VERIFIED_MEMBER_THRESHOLD,
  JoinAutoConnectionAdmitsError,
  JoinAutoDomainUnprovenError,
  JoinNotAvailableError,
  JoinRequestNotFoundError,
  JoinRequestThrottledError,
  joinDomainOf,
  isPublicEmailDomain,
  type JoinRequestAggregateState,
} from "@langwatch/identity-contract";
import {
  JOIN_LOOKUPS_PER_WINDOW,
  JOIN_REJECTION_COOLDOWN_MS,
  JOIN_REQUESTS_PER_WINDOW,
  JOIN_REQUEST_RATE_WINDOW_SECONDS,
  type JoinRequestsServiceDeps,
} from "../rules/join-requests-contract.rules.ts";

const logger = createLogger("langwatch:identity:join-requests");

export class JoinRequestAdmissionGuardsService {
  static create(
    deps: JoinRequestsServiceDeps,
    now: () => number,
  ): JoinRequestAdmissionGuardsService {
    return new JoinRequestAdmissionGuardsService(deps, now);
  }

  private constructor(
    private readonly deps: JoinRequestsServiceDeps,
    private readonly now: () => number,
  ) {}

  /** The request, if this organization has one by that id. A request from
   *  somewhere else is answered as if it did not exist. */
  async ownedRequestOrRefuse({
    joinRequestId,
    organizationId,
  }: {
    joinRequestId: string;
    organizationId: string;
  }): Promise<JoinRequestAggregateState> {
    const request = await this.deps.reads.tryFindRequest({ joinRequestId });
    if (!request || request.organizationId !== organizationId) {
      throw new JoinRequestNotFoundError(
        `join request ${joinRequestId} does not belong to ${organizationId}`,
      );
    }

    return request;
  }

  /** The domain the caller has PROVED, or the universal nothing. */
  provenDomainOrRefuse({ verifiedEmail }: { verifiedEmail: string | null }): string {
    const domain = verifiedEmail ? joinDomainOf(verifiedEmail) : null;
    if (!domain || isPublicEmailDomain(domain)) {
      throw new JoinNotAvailableError("no verified company address is available for this request");
    }

    return domain;
  }

  async assertNotAsking({
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

    logger.debug({ organizationId }, "join request rate limit checked for an asking user");
  }

  async assertNotLooking({ userId }: { userId: string }): Promise<void> {
    const limit = await this.deps.rateLimit({
      key: `joinRequests.lookup:${userId}`,
      windowSeconds: JOIN_REQUEST_RATE_WINDOW_SECONDS,
      max: JOIN_LOOKUPS_PER_WINDOW,
    });
    if (!limit.allowed) {
      throw new JoinRequestThrottledError(retryAfterSeconds(limit.resetAt));
    }
  }

  async assertNotInCoolDown({
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
    if (!rejectedAt) {
      return;
    }

    const clearsAt = rejectedAt.getTime() + JOIN_REJECTION_COOLDOWN_MS;
    const now = this.now();
    if (now >= clearsAt) {
      return;
    }

    // The throttle code, not a rejection code: see the cool-down constant.
    throw new JoinRequestThrottledError(Math.ceil((clearsAt - now) / 1000));
  }

  /**
   * Automatic joining needs the administrator to have named the domain AND a
   * second verified member on it. One colleague with a company-looking
   * address at a small vendor is not evidence a company owns a domain.
   */
  async assertDomainProven({
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
  return Math.max(1, Math.ceil((resetAt - nowInstant().epochMilliseconds) / 1000));
}
