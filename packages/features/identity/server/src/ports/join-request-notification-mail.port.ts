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
  }): Promise<unknown>;

  /** The domain policy admitted somebody. Sent to one organization admin. */
  abstract sendJoinedAutomatically(input: {
    adminEmail: string;
    organizationName: string;
    memberName: string;
    domain: string;
  }): Promise<unknown>;
}
