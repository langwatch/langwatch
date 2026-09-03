import { JoinRequestMailPort } from "@langwatch/identity-server";
import type { MailRenderPort } from "@langwatch/mail";
import type { EmailDeliveryPort } from "@langwatch/notification-server";

/**
 * The two join-request mails this process's wakes send (D12).
 *
 * The ENVELOPE lives here, in the composition root: which address is written
 * to, which gateway the message leaves through, and the deployment's own host
 * that every link is built from. None of that is a fact the identity feature
 * knows, and what the feature owns is who is told and what happens when
 * telling them fails.
 *
 * The WORDS do not live here. They are `@langwatch/mail`'s, rendered through
 * `MailRenderPort`, because this file used to hold a `createElement`
 * translation of the same two mails the mail package already rendered from
 * JSX — a twin, and one that put react-email on the worker's boot graph. A
 * drift between twins is invisible in production: two admins on one
 * organization would receive two differently-worded reminders depending on
 * which process happened to hold the wake, and nobody sees both.
 *
 * Two rules run through both messages, and they are pinned where the words
 * are.
 *
 * No mail carries an action link that decides anything. An admin approves in
 * the members area, behind their session; a link in mail that approved a
 * request would be a second, unauthenticated way to add somebody to an
 * organization.
 *
 * And the lapse notice says nothing about why, and does not name who said no.
 * The ending is deliberately quiet: a requester who learns which colleague
 * turned them down has learned something that is not theirs.
 */
export class JoinRequestMailAdapter extends JoinRequestMailPort {
  static create(options: {
    mailer: EmailDeliveryPort;
    /** Renders the words. `ReactEmailMailRenderer` in every real process. */
    renderer: MailRenderPort;
    /** The deployment's own host, as every link in these mails is built from. */
    baseHost: string;
  }): JoinRequestMailAdapter {
    return new JoinRequestMailAdapter(options.mailer, options.renderer, options.baseHost);
  }

  private constructor(
    private readonly mailer: EmailDeliveryPort,
    private readonly renderer: MailRenderPort,
    private readonly baseHost: string,
  ) {
    super();
  }

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
 * The join-request mail port for a process that has no mail gateway.
 *
 * A NAMED absence rather than a quiet one. The pipeline mounts either way and
 * must: `join-requests` names five commands, a state projection and the
 * lifecycle subscriber in the checked-in job registry, and a consumer missing
 * any of them rejects those jobs for redelivery forever while every health
 * signal stays green. Expiry in particular is a fold this graph still performs
 * — a request lapses on time whether or not anybody can be told.
 *
 * So the send throws, loudly and by name, and the notification fan-out logs it
 * and lets the request stand — which is exactly what a deployment with no
 * email provider configured already does today. What this must never become is
 * a no-op that resolves: a silent success would report every notification as
 * sent, and the one thing worse than an unsent reminder is a graph that says
 * it sent one.
 *
 * A process that CLAIMS `event-sourcing/jobs` never gets here:
 * `WorkerProductionComposition` refuses to compose that graph without mail.
 */
export class AbsentJoinRequestMail extends JoinRequestMailPort {
  static create(): AbsentJoinRequestMail {
    return new AbsentJoinRequestMail();
  }

  private constructor() {
    super();
  }

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
