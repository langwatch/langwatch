import {
  sendIdpRefusedSignInEmail,
  sendSeatRequestEmail,
  type MailSender,
  type SeatRequestProps,
} from "@langwatch/mail";
import type { NotificationService } from "@langwatch/notification-contract";
import { OrganizationCapabilityUnavailableError } from "@langwatch/organization-contract";

import { AccessNoticeMailChannel, type IdpRefusedMail } from "../access-notice-mail.channel.ts";

type Notifications = Pick<NotificationService, "sendEmail" | "getMailDelivery">;
type Envelope = Readonly<{ idempotencyKey: string }>;

/** Access notices over notification; with no mail gateway named a send fails and is logged. */
export class SesAccessNoticeMailChannel extends AccessNoticeMailChannel {
  static create(input: { notifications: Notifications }): SesAccessNoticeMailChannel {
    return new SesAccessNoticeMailChannel({
      send: async (content) => {
        const { provider } = await input.notifications.getMailDelivery();
        if (provider === undefined) {
          throw new OrganizationCapabilityUnavailableError("email sending");
        }
        await input.notifications.sendEmail(content);
      },
    });
  }

  private constructor(private readonly mailer: MailSender) {
    super();
  }

  sendSeatRequest(input: SeatRequestProps & Envelope): Promise<void> {
    return sendSeatRequestEmail({ ...input, mailer: this.mailer });
  }

  sendIdpRefused(input: IdpRefusedMail & Envelope): Promise<void> {
    return sendIdpRefusedSignInEmail({ ...input, mailer: this.mailer });
  }
}
