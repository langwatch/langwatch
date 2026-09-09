/**
 * The six messages a join request sends, as the notifier asks for them.
 *
 * The notifier decides WHO is told — it reads the organization's admins, the
 * requester's display name and their address — and this port decides WHAT they
 * read. That split is what keeps the react-email rendering, the mail gateway
 * and the deployment's public host out of every process that composes the
 * identity graph: a backend process resolving a join request must not pull a
 * React renderer onto its import graph to do it.
 *
 * Every method takes resolved names and addresses. Nothing here is asked to
 * look anything up.
 */
export abstract class JoinRequestNotificationMailPort {
  /** Somebody is asking. Sent to one organization admin. */
  abstract sendRequestArrived(input: {
    adminEmail: string;
    organizationName: string;
    requesterName: string;
    domain: string;
    /**
     * How many requests from this domain have already been approved.
     *
     * An admin approving a third colleague from one domain is doing by hand
     * what one setting does for them. Absent, or below the habit floor, the
     * mail says nothing about it.
     */
    approvedFromDomainCount?: number;
  }): Promise<unknown>;

  /** The one nudge, on the seventh day. Sent to one organization admin. */
  abstract sendRequestStillWaiting(input: {
    adminEmail: string;
    organizationName: string;
    requesterName: string;
  }): Promise<unknown>;

  /** They are in. Sent to the requester. */
  abstract sendRequestApproved(input: {
    requesterEmail: string;
    organizationName: string;
    /**
     * Why the organization came, where its row says.
     *
     * This message is the first one a new member gets, and unlike the sign-up
     * confirmation it is sent when an organization already exists to have an
     * answer. Absent falls back to the steps every reader can take.
     */
    intent?: "AGENT_GOVERNANCE" | "LLM_OPS";
  }): Promise<unknown>;

  /** They are not. Sent to the requester, who may ask again after the cool-down. */
  abstract sendRequestRejected(input: {
    requesterEmail: string;
    organizationName: string;
  }): Promise<unknown>;

  /** Nobody answered in time. Sent to the requester, who may ask again. */
  abstract sendRequestExpired(input: {
    requesterEmail: string;
    organizationName: string;
    /**
     * A personal project of their own to work in meanwhile, when they have one.
     *
     * A second line and never the button: the thing this reader came for is the
     * organization, and asking again is what they do next.
     */
    personalProjectUrl?: string;
  }): Promise<unknown>;

  /** The domain policy admitted somebody. Sent to one organization admin. */
  abstract sendJoinedAutomatically(input: {
    adminEmail: string;
    organizationName: string;
    memberName: string;
    domain: string;
    /**
     * Seats held after this join, against what the plan covers.
     *
     * Absent for an organization on enterprise or negotiated terms, whose
     * ceiling is its own rather than the public ladder's.
     */
    seats?: { used: number; ceiling: number };
  }): Promise<unknown>;
}
