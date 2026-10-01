import type { JoinRequestNotificationMail } from "../../app/identity.members.ts";
import { JoinRequestNotificationMailChannel } from "../join-request-notification-mail.channel.ts";

type Sent = {
  [Name in keyof JoinRequestNotificationMail]: {
    kind: Name;
    input: Parameters<JoinRequestNotificationMail[Name]>[0];
  };
}[keyof JoinRequestNotificationMail];

/** Records each join-request mail it is handed and sends nothing. */
export class MemoryJoinRequestNotificationMailChannel extends JoinRequestNotificationMailChannel {
  static create(): MemoryJoinRequestNotificationMailChannel {
    return new MemoryJoinRequestNotificationMailChannel();
  }

  readonly sent: Sent[] = [];

  private constructor() {
    super();
  }

  async sendRequestArrived(
    input: Parameters<JoinRequestNotificationMail["sendRequestArrived"]>[0],
  ): Promise<void> {
    this.sent.push({ kind: "sendRequestArrived", input });
  }

  async sendRequestStillWaiting(
    input: Parameters<JoinRequestNotificationMail["sendRequestStillWaiting"]>[0],
  ): Promise<void> {
    this.sent.push({ kind: "sendRequestStillWaiting", input });
  }

  async sendRequestApproved(
    input: Parameters<JoinRequestNotificationMail["sendRequestApproved"]>[0],
  ): Promise<void> {
    this.sent.push({ kind: "sendRequestApproved", input });
  }

  async sendRequestRejected(
    input: Parameters<JoinRequestNotificationMail["sendRequestRejected"]>[0],
  ): Promise<void> {
    this.sent.push({ kind: "sendRequestRejected", input });
  }

  async sendRequestExpired(
    input: Parameters<JoinRequestNotificationMail["sendRequestExpired"]>[0],
  ): Promise<void> {
    this.sent.push({ kind: "sendRequestExpired", input });
  }

  async sendJoinedAutomatically(
    input: Parameters<JoinRequestNotificationMail["sendJoinedAutomatically"]>[0],
  ): Promise<void> {
    this.sent.push({ kind: "sendJoinedAutomatically", input });
  }
}
