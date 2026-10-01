import type {
  JoinCandidateOrganization,
  JoinRequestAggregateState,
} from "@langwatch/identity-contract";
import type { Instant } from "@langwatch/time";

/**
 * What the join-request guards and the matcher READ (D12). Ports, not implementations: this package
 * states what a decision needs to know, and the app satisfies it out of Postgres. Every read here
 * answers in counts and enums.
 */

/** The folded head of one request — the `JoinRequest` projection row. */
export abstract class JoinRequestReadRepository {
  /** Throws `JoinRequestNotFoundError` when no request carries this id. */
  abstract getRequest(args: { joinRequestId: string }): Promise<JoinRequestAggregateState>;

  /** The one open request per person per organization; `JoinRequestNotFoundError` when none. */
  abstract getPendingRequest(args: {
    userId: string;
    organizationId: string;
  }): Promise<JoinRequestAggregateState>;
}

/**
 * What the join-request SERVICE reads on top of the guards' two reads: the throttle's last
 * rejection, and the two waiting-list queries the request and inbox surfaces are served from.
 */
export abstract class JoinRequestListReadRepository extends JoinRequestReadRepository {
  /** When this person was last rejected here; `JoinRequestNotFoundError` when never. */
  abstract getLastRejectionAt(args: { userId: string; organizationId: string }): Promise<Instant>;

  /** Everything waiting on one organization, newest ask first. */
  abstract findPendingForOrganization(args: {
    organizationId: string;
  }): Promise<JoinRequestAggregateState[]>;

  /** Who a domain setting admitted with nobody approving, resolved from `resolvedAfterMs`. */
  abstract findAutomaticJoinsForOrganization(args: {
    organizationId: string;
    resolvedAfterMs: number;
  }): Promise<JoinRequestAggregateState[]>;

  /** Everything one person is waiting on. */
  abstract findPendingForUser(args: { userId: string }): Promise<JoinRequestAggregateState[]>;

  /** The approved requests of these people on one organization; bounded by both. */
  abstract findApprovedForMembers(args: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<JoinRequestAggregateState[]>;
}

/**
 * The organizations a domain could reach, as counts and flags. The implementation counts members
 * holding a VERIFIED identifier on the domain — an unverified address is not evidence, and counting
 * one would let anybody make any organization look like theirs by typing an address at it.
 */
export abstract class JoinCandidateRepository {
  abstract findCandidateOrganizations(args: {
    domain: string;
  }): Promise<JoinCandidateOrganization[]>;

  /** One organization's own candidacy, for the "you named it directly" path.
   *  Throws `JoinNotAvailableError` when it does not exist — the refusal an
   *  organization that exists and is closed produces. */
  abstract getCandidateOrganization(args: {
    organizationId: string;
    domain: string;
  }): Promise<JoinCandidateOrganization>;
}
