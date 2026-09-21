import type {
  JoinCandidateOrganization,
  JoinRequestAggregateState,
} from "@langwatch/identity";

/**
 * What the join-request guards and the matcher READ (D12). Ports, not
 * implementations: this package states what a decision needs to know, and the
 * app satisfies it out of Postgres.
 *
 * Every read here answers in counts and enums. No member of any organization
 * is ever named to make a join decision, which is what keeps the lookup from
 * being a directory of who works where even by accident.
 */

/** The folded head of one request — the `JoinRequest` projection row. */
export interface JoinRequestReadRepository {
  findRequest(args: {
    joinRequestId: string;
  }): Promise<JoinRequestAggregateState | null>;

  /** The one-open-request-per-person-per-organization check. */
  findPendingRequest(args: {
    userId: string;
    organizationId: string;
  }): Promise<JoinRequestAggregateState | null>;
}

/**
 * The organizations a domain could reach, as counts and flags.
 *
 * The implementation counts members holding a VERIFIED identifier on the
 * domain — an unverified address is not evidence, and counting one would let
 * anybody make any organization look like theirs by typing an address at it.
 */
export interface JoinCandidateRepository {
  findCandidateOrganizations(args: {
    domain: string;
  }): Promise<JoinCandidateOrganization[]>;

  /** One organization's own candidacy, for the "you named it directly" path.
   *  Null when it does not exist — which the boundary answers exactly as it
   *  answers an organization that exists and is closed. */
  findCandidateOrganization(args: {
    organizationId: string;
    domain: string;
  }): Promise<JoinCandidateOrganization | null>;
}
