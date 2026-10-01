import type { JoinRequestNotificationMail } from "../app/identity.members.ts";

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
