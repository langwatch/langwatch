/**
 * The two mails a join request's own timers send (D12).
 *
 * Only two, deliberately. The other four — arrived, approved, rejected, the
 * automatic-join notice — are sent by the request-side service in answer to
 * something a person did, and that service has not moved. These two are the
 * ones the process manager's wakes own: nobody asked for them, and if the
 * process that holds the wakes cannot send them, nobody sends them at all.
 *
 * The port takes resolved names and addresses rather than ids: deciding WHO is
 * told is this package's job, and WHAT they read is the composition root's,
 * beside the mail gateway and the deployment host every link is built from.
 */
export abstract class JoinRequestMailPort {
  /** The one nudge, on the seventh day. Sent to one organization admin. */
  abstract sendStillWaiting(input: {
    adminEmail: string;
    organizationName: string;
    requesterName: string;
  }): Promise<void>;

  /** Nobody answered in time. Sent to the requester, who may ask again. */
  abstract sendExpired(input: { requesterEmail: string; organizationName: string }): Promise<void>;
}
