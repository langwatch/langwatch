/**
 * The narrow collaborator shapes an arrival through a connection is given,
 * beside the two peer APIs it orchestrates. Each is a thing the module does
 * not own, named by the one question this service asks of it.
 */

/** The person arriving, as every step of an admission names them. */
export interface ArrivingUser {
  id: string;
  email: string;
  name: string;
}

/** The organization they land in. */
export interface JoinedOrganization {
  id: string;
  name: string;
}

/**
 * The membership half of an arrival, answered by the app from the
 * organization peer's `*Api` token (ADR-129). Identity never writes an
 * `OrganizationUser` row itself; it asks the module that owns one.
 */
export interface SsoArrivalMemberships {
  isMember(args: { organizationId: string; userId: string }): Promise<boolean>;
  /** Makes them a MEMBER, carrying the grant intent an unfinished admission
   *  is resumed from. `"already-present"` is a retry, not a failure. */
  createMembership(args: {
    organizationId: string;
    userId: string;
  }): Promise<"created" | "already-present">;
  /**
   * Applies the PENDING invitation this address already holds, as ONE
   * decision: an invitation that exists wins, and its role and team
   * assignments replace a default membership entirely.
   */
  applyPendingInvite(args: {
    userId: string;
    organizationId: string;
    email: string;
  }): Promise<Readonly<{ applied: true; inviteId: string }> | Readonly<{ applied: false }>>;
  /** The organization a membership lands in, as the announcement names it. */
  findOrganization(args: { organizationId: string }): Promise<JoinedOrganization | null>;
}

/** `raised: false` is the cool-down swallowing it, which is not a failure. */
export type SsoArrivalJoinRequestRaised =
  | Readonly<{ raised: true; joinRequestId: string }>
  | Readonly<{ raised: false }>;

export interface SsoArrivalJoinRequests {
  /** Raises the request an arrival on a connection that ASKS stands. */
  requestFromSsoArrival(args: {
    userId: string;
    organizationId: string;
    domain: string;
  }): Promise<SsoArrivalJoinRequestRaised>;
}

export interface SsoArrivalNotifications {
  /** The durable notice an automatic admission owes the administrators. */
  joinedAutomatically(args: {
    organizationId: string;
    requesterUserId: string;
    domain: string;
    admissionId: string;
  }): Promise<void>;
  /** Tells the team somebody signed up through a domain rule. */
  announceSignup(args: { userName: string; userEmail: string; organizationName: string }): void;
  /** Starts the nurturing sequence an automatically added member gets. */
  startNurturing(args: {
    userId: string;
    email: string;
    name: string;
    organizationId: string;
    organizationName: string;
  }): void;
}

/**
 * Adopting one admitted person into the identifier population, rather than a
 * fleet-wide pass. Declared rather than defaulted: a deployment that cannot
 * run it has to say so, not discover it in a log.
 */
export interface SsoArrivalIdentityAdoption {
  adopt(args: { userId: string }): Promise<void>;
}
