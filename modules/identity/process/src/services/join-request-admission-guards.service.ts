import {
  JoinAutoConnectionAdmitsError,
  JoinAutoDomainUnprovenError,
  JoinNotAvailableError,
  JoinRequestNotFoundError,
  JoinRequestThrottledError,
  joinDomainOf,
  isPublicEmailDomain,
  type JoinRequestAggregateState,
} from "@langwatch/identity-contract";
/**
 * Whether a person may ask at all: are they asking too often, looking too often, still inside
 * a rejection's cool-down, is the domain they claim actually held by the organization, and is
 * the request they name one this organization owns. Every refusal is thrown, never returned.
 */
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

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
    const secondsLeft = await this.coolDownSecondsLeft({ userId, organizationId });
    if (secondsLeft === 0) {
      return;
    }

    // The throttle code, not a rejection code: see the cool-down constant.
    throw new JoinRequestThrottledError(secondsLeft);
  }

  /**
   * The same cool-down, answered rather than refused. An arrival through a
   * connection makes a request because an account row appeared, not because
   * anybody clicked, and no caller there is waiting for a reason.
   */
  async isInCoolDown(args: { userId: string; organizationId: string }): Promise<boolean> {
    return (await this.coolDownSecondsLeft(args)) > 0;
  }

  /** How long a rejected person still waits, or zero when they do not. */
  private async coolDownSecondsLeft({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<number> {
    const rejectedAt = await this.deps.reads.tryFindLastRejectionAt({
      userId,
      organizationId,
    });
    if (!rejectedAt) {
      return 0;
    }

    const clearsAt = rejectedAt.epochMilliseconds + JOIN_REJECTION_COOLDOWN_MS;
    const now = this.now();
    if (now >= clearsAt) {
      return 0;
    }

    return Math.ceil((clearsAt - now) / 1000);
  }

  /**
   * Automatic joining needs the administrator to have named the domain AND the
   * organization to have PROVED it controls it. Members' verified addresses are
   * not evidence: this is the one path with nobody in the loop to notice.
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

    // A lapsed proof and a proof that never existed refuse identically, and
    // for the same reason: what would authorize walking in is evidence the
    // organization controls the domain, and right now there is none.
    if (!candidate?.domainProved) {
      throw new JoinAutoDomainUnprovenError(
        `${domain} is not proved for ${organizationId}; automatic joining needs a verified domain`,
      );
    }
  }
}

/** What the screen says is left, from the limiter's own answer. */
function retryAfterSeconds(resetAt: number): number {
  return Math.max(1, Math.ceil((resetAt - nowInstant().epochMilliseconds) / 1000));
}
