import { type JoinRequestMail } from "@langwatch/identity-server";
import type { MailRender } from "@langwatch/mail";
import type { EmailDelivery } from "@langwatch/notification-server";

/**
 * The two join-request mails this process sends (D12).
 * ENVELOPE here (from, gateway, host); WORDS in @langwatch/mail via MailRender.
 */
export class JoinRequestMailAdapter implements JoinRequestMail {
  static create(options: {
    mailer: EmailDelivery;
    /** Renders the words. `ReactEmailMailRenderer` in every real process. */
    renderer: MailRender;
    /** The deployment's own host, as every link in these mails is built from. */
    baseHost: string;
  }): JoinRequestMailAdapter {
    return new JoinRequestMailAdapter(options.mailer, options.renderer, options.baseHost);
  }

  private constructor(
    private readonly mailer: EmailDelivery,
    private readonly renderer: MailRender,
    private readonly baseHost: string,
  ) {}

  /** The one nudge, on the seventh day. */
  async sendStillWaiting({
    adminEmail,
    organizationName,
    requesterName,
  }: {
    adminEmail: string;
    organizationName: string;
    requesterName: string;
  }): Promise<void> {
    const html = await this.renderer.renderJoinRequestReminder({
      organizationName,
      requesterName,
      membersSettingsUrl: `${this.baseHost}/settings/members`,
    });
    await this.mailer.send({
      to: adminEmail,
      subject: `${requesterName} is still waiting to join ${organizationName}`,
      html,
    });
  }

  /** Nobody answered in time. Sent to the requester, who may ask again. */
  async sendExpired({
    requesterEmail,
    organizationName,
  }: {
    requesterEmail: string;
    organizationName: string;
  }): Promise<void> {
    const html = await this.renderer.renderJoinRequestExpiry({ organizationName });
    await this.mailer.send({
      to: requesterEmail,
      subject: `Your request to join ${organizationName} lapsed`,
      html,
    });
  }
}

/**
 * The join-request mail port for a process with no mail gateway.
 * Throws loudly rather than silently succeeding — avoids false "sent" claims.
 */
export class AbsentJoinRequestMail implements JoinRequestMail {
  static create(): AbsentJoinRequestMail {
    return new AbsentJoinRequestMail();
  }

  private constructor() {}

  async sendStillWaiting(_input: {
    adminEmail: string;
    organizationName: string;
    requesterName: string;
  }): Promise<void> {
    throw new Error(ABSENT_MAIL_MESSAGE);
  }

  async sendExpired(_input: { requesterEmail: string; organizationName: string }): Promise<void> {
    throw new Error(ABSENT_MAIL_MESSAGE);
  }
}

const ABSENT_MAIL_MESSAGE =
  "This process composed no outbound mail gateway, so join-request notifications cannot be sent. Set BASE_HOST and an email provider.";
