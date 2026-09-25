import {
  sendDomainAutoJoinedEmail,
  sendJoinRequestApprovedEmail,
  sendJoinRequestArrivedEmail,
  sendJoinRequestExpiredEmail,
  sendJoinRequestReminderEmail,
  sendJoinRequestRejectedEmail,
  type EmailDelivery,
} from "@langwatch/mail";

import type { JoinRequestNotificationMail } from "../../app/identity.members.ts";
import { JoinRequestNotificationMailChannel } from "../join-request-notification-mail.channel.ts";

type Input<Name extends keyof JoinRequestNotificationMail> = Parameters<
  JoinRequestNotificationMail[Name]
>[0];

/** Main's join-request mails over the process's mail member; mail off skips each with one line. */
export class SesJoinRequestNotificationMailChannel extends JoinRequestNotificationMailChannel {
  static create(input: {
    mailer: EmailDelivery;
    baseUrl: string;
  }): SesJoinRequestNotificationMailChannel {
    return new SesJoinRequestNotificationMailChannel(input.mailer, input.baseUrl);
  }

  private constructor(
    private readonly mailer: EmailDelivery,
    private readonly baseUrl: string,
  ) {
    super();
  }

  private membersSettingsUrl(): string {
    return `${this.baseUrl}/settings/members`;
  }

  sendRequestArrived(input: Input<"sendRequestArrived">): Promise<void> {
    return sendJoinRequestArrivedEmail({
      ...input,
      membersSettingsUrl: this.membersSettingsUrl(),
      mailer: this.mailer,
    });
  }

  sendRequestStillWaiting({
    adminEmail,
    ...input
  }: Input<"sendRequestStillWaiting">): Promise<void> {
    return sendJoinRequestReminderEmail({
      ...input,
      adminEmail,
      membersSettingsUrl: this.membersSettingsUrl(),
      mailer: this.mailer,
    });
  }

  sendRequestApproved({
    requesterEmail,
    organizationName,
  }: Input<"sendRequestApproved">): Promise<void> {
    return sendJoinRequestApprovedEmail({
      requesterEmail,
      organizationName,
      organizationUrl: this.baseUrl,
      mailer: this.mailer,
    });
  }

  sendRequestRejected(input: Input<"sendRequestRejected">): Promise<void> {
    return sendJoinRequestRejectedEmail({ ...input, mailer: this.mailer });
  }

  sendRequestExpired({ requesterEmail, ...input }: Input<"sendRequestExpired">): Promise<void> {
    return sendJoinRequestExpiredEmail({ ...input, requesterEmail, mailer: this.mailer });
  }

  sendJoinedAutomatically(input: Input<"sendJoinedAutomatically">): Promise<void> {
    return sendDomainAutoJoinedEmail({
      ...input,
      membersSettingsUrl: this.membersSettingsUrl(),
      mailer: this.mailer,
    });
  }
}
