/**
 * The narrow collaborator shapes an arrival through a connection is given,
 * beside the two peer APIs it orchestrates. Each is a thing the module does
 * not own, named by the one question this service asks of it.
 */

/** The organization they land in. */
export interface JoinedOrganization {
  id: string;
  name: string;
}

/** What a membership write answered: whether the row is new, and its seat (ADR-171). */
export interface SsoMembershipWrite {
  outcome: "created" | "already-present";
  seat: "MEMBER" | "DEVELOPER";
}

/**
 * The membership half of an arrival, answered by the app from the
 * organization peer's `*Api` token (ADR-129). Identity never writes an
 * `OrganizationUser` row itself; it asks the module that owns one.
 */
export interface SsoArrivalMemberships {
  isMember(args: { organizationId: string; userId: string }): Promise<boolean>;
  /**
   * Makes them a member on the organization's joiner seat (ADR-171): a Full
   * member carrying the grant intent an unfinished admission is resumed from,
   * or a Developer with no grant at all. `"already-present"` is a retry.
   */
  createMembership(args: { organizationId: string; userId: string }): Promise<SsoMembershipWrite>;
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

/** Tells our own team somebody signed up through a domain rule; never fatal to the sign-in. */
export interface SsoArrivalSignupAnnouncement {
  announce(args: { userName: string; userEmail: string; organizationName: string }): Promise<void>;
}

export interface SsoArrivalNotifications {
  /**
   * The durable notice an automatic admission owes the administrators.
   * `admissionId` names the grant a Full member's admission attached; a
   * Developer holds none (ADR-171), so the row alone is the admission.
   */
  joinedAutomatically(args: {
    organizationId: string;
    requesterUserId: string;
    domain: string;
    admissionId?: string;
  }): Promise<void>;
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
