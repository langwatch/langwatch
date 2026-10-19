/**
 * The notifier decides WHO is told; this port decides WHAT they read. That
 * split keeps react-email rendering and the mail gateway out of every process
 * composing the identity graph. Every method takes resolved names/addresses.
 */
export interface JoinRequestNotificationMail {
  /** Somebody is asking. Sent to one organization admin. */
  sendRequestArrived(input: {
    adminEmail: string;
    organizationName: string;
    requesterName: string;
    domain: string;
    /**
     * How many requests from this domain have already been approved. Absent,
     * or below the habit floor, the mail says nothing about it.
     */
    approvedFromDomainCount?: number;
    /** This recipient's delivery identity, so a retry is not a second mail. */
    idempotencyKey?: string;
  }): Promise<unknown>;

  /** The one nudge, on the seventh day. Sent to one organization admin. */
  sendRequestStillWaiting(input: {
    adminEmail: string;
    organizationName: string;
    requesterName: string;
    /** This recipient's delivery identity, so a retry is not a second mail. */
    idempotencyKey?: string;
  }): Promise<unknown>;

  /** They are in. Sent to the requester. */
  sendRequestApproved(input: {
    requesterEmail: string;
    organizationName: string;
    /**
     * Why the organization came, where its row says it. Absent falls back to
     * the steps every reader can take.
     */
    intent?: "AGENT_GOVERNANCE" | "LLM_OPS";
    /** This recipient's delivery identity, so a retry is not a second mail. */
    idempotencyKey?: string;
  }): Promise<unknown>;

  /** They are not. Sent to the requester, who may ask again after the cool-down. */
  sendRequestRejected(input: {
    requesterEmail: string;
    organizationName: string;
    /** This recipient's delivery identity, so a retry is not a second mail. */
    idempotencyKey?: string;
  }): Promise<unknown>;

  /** Nobody answered in time. Sent to the requester, who may ask again. */
  sendRequestExpired(input: {
    requesterEmail: string;
    organizationName: string;
    /**
     * A personal project to work in meanwhile, when they have one. A second
     * line, never the button — the organization is what this reader came for.
     */
    personalProjectUrl?: string;
    /** This recipient's delivery identity, so a retry is not a second mail. */
    idempotencyKey?: string;
  }): Promise<unknown>;

  /** The domain policy admitted somebody. Sent to one organization admin. */
  sendJoinedAutomatically(input: {
    adminEmail: string;
    organizationName: string;
    memberName: string;
    domain: string;
    /**
     * Seats held after this join, against what the plan covers. Absent for
     * enterprise/negotiated terms, whose ceiling is not the public ladder's.
     */
    seats?: { used: number; ceiling: number };
    /** This recipient's delivery identity, so a retry is not a second mail. */
    idempotencyKey?: string;
  }): Promise<unknown>;
}

/**
 * The six join-request mails, as identity hands them over: who is told is the notifier's
 * decision, the envelope and template the mail composition's. The memory tier records and
 * sends nothing.
 */
export abstract class JoinRequestNotificationMailChannel implements JoinRequestNotificationMail {
  abstract sendRequestArrived(
    input: Parameters<JoinRequestNotificationMail["sendRequestArrived"]>[0],
  ): Promise<void>;
  abstract sendRequestStillWaiting(
    input: Parameters<JoinRequestNotificationMail["sendRequestStillWaiting"]>[0],
  ): Promise<void>;
  abstract sendRequestApproved(
    input: Parameters<JoinRequestNotificationMail["sendRequestApproved"]>[0],
  ): Promise<void>;
  abstract sendRequestRejected(
    input: Parameters<JoinRequestNotificationMail["sendRequestRejected"]>[0],
  ): Promise<void>;
  abstract sendRequestExpired(
    input: Parameters<JoinRequestNotificationMail["sendRequestExpired"]>[0],
  ): Promise<void>;
  abstract sendJoinedAutomatically(
    input: Parameters<JoinRequestNotificationMail["sendJoinedAutomatically"]>[0],
  ): Promise<void>;
}
