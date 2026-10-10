import { sendInviteEmail, sendInviteReRequestEmail, type MailSender } from "@langwatch/mail";
import type { NotificationService } from "@langwatch/notification-contract";
import { OrganizationCapabilityUnavailableError } from "@langwatch/organization-contract";

import type { OrganizationInviteMail } from "../organization-invite-mail.channel.ts";
import { OrganizationInviteMailChannel } from "../organization-invite-mail.channel.ts";

type Input<Name extends keyof OrganizationInviteMail> = Parameters<OrganizationInviteMail[Name]>[0];

type Notifications = Pick<NotificationService, "sendEmail" | "getMailDelivery">;

/**
 * Main's invitation mails over notification. With no gateway named a send fails, as on main,
 * so the invitation reports `emailNotSent` and is shared as a link instead.
 */
export class SesOrganizationInviteMailChannel extends OrganizationInviteMailChannel {
  static create(input: { notifications: Notifications }): SesOrganizationInviteMailChannel {
    return new SesOrganizationInviteMailChannel({
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

  sendInvite(input: Input<"sendInvite">): Promise<void> {
    return sendInviteEmail({ ...input, mailer: this.mailer });
  }

  sendInviteReRequest(input: Input<"sendInviteReRequest">): Promise<void> {
    return sendInviteReRequestEmail({ ...input, mailer: this.mailer });
  }
}
