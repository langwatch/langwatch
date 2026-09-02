import { JoinRequestMailPort } from "@langwatch/identity-server";
import type { EmailDeliveryPort } from "@langwatch/notification-server";
import { Button, Container, Heading, Html, Img } from "@react-email/components";
import { render } from "@react-email/render";
import { createElement, Fragment, type ReactNode } from "react";

/**
 * The two join-request mails this process's wakes send (D12).
 *
 * The words live here, in the composition root, for the same reason the
 * application keeps its own in `src/server/mailer/`: a template is
 * presentation bound to a deployment — it needs the host every link points at
 * and the gateway the message leaves through, and neither is a fact the
 * identity feature knows. What the feature owns is who is told and what
 * happens when telling them fails.
 *
 * Two rules run through both of them.
 *
 * No mail carries an action link that decides anything. An admin approves in
 * the members area, behind their session; a link in mail that approved a
 * request would be a second, unauthenticated way to add somebody to an
 * organization.
 *
 * And the lapse notice says nothing about why, and does not name who said no.
 * The ending is deliberately quiet: a requester who learns which colleague
 * turned them down has learned something that is not theirs.
 *
 * Written with `createElement` rather than JSX because the strict feature
 * layout admits no `.tsx` module and this package's TypeScript project builds
 * `.ts` only. The element TREE is what `render` turns into HTML, so this
 * produces the same bytes the application's JSX does — which the twin-drift
 * test beside it pins, literal for literal.
 */
export class JoinRequestMailAdapter extends JoinRequestMailPort {
  static create(options: {
    mailer: EmailDeliveryPort;
    /** The deployment's own host, as every link in these mails is built from. */
    baseHost: string;
  }): JoinRequestMailAdapter {
    return new JoinRequestMailAdapter(options.mailer, options.baseHost);
  }

  private constructor(
    private readonly mailer: EmailDeliveryPort,
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
    const html = await render(
      shell({
        heading: "A request to join is still waiting",
        children: createElement(
          Fragment,
          null,
          createElement(
            "p",
            null,
            createElement("strong", null, requesterName),
            " asked to join ",
            createElement("strong", null, organizationName),
            " a week ago and nobody has answered yet.",
          ),
          createElement(
            "p",
            null,
            "It lapses in another week. This is the only reminder we send about it.",
          ),
          actionButton(`${this.baseHost}/settings/members`, "Open members settings"),
        ),
      }),
    );
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
    const html = await render(
      shell({
        heading: "Your request lapsed",
        children: createElement(
          Fragment,
          null,
          createElement(
            "p",
            null,
            "Nobody answered your request to join ",
            createElement("strong", null, organizationName),
            " on LangWatch within two weeks, so it lapsed.",
          ),
          createElement("p", null, "You can ask again whenever you like."),
        ),
      }),
    );
    await this.mailer.send({
      to: requesterEmail,
      subject: `Your request to join ${organizationName} lapsed`,
      html,
    });
  }
}

const shell = ({ heading, children }: { heading: string; children: ReactNode }) =>
  createElement(
    Html,
    { lang: "en", dir: "ltr" },
    createElement(
      Container,
      {
        style: {
          border: "1px solid #F2F4F8",
          borderRadius: "10px",
          padding: "24px",
          paddingBottom: "12px",
        },
      },
      createElement(Img, {
        src: "https://app.langwatch.ai/images/logo-icon.png",
        alt: "LangWatch Logo",
        width: "36",
      }),
      createElement(Heading, { as: "h1" }, heading),
      children,
    ),
  );

const actionButton = (href: string, label: string) =>
  createElement(
    Button,
    {
      href,
      style: {
        padding: "10px 20px",
        color: "white",
        backgroundColor: "#ED8926",
        textDecoration: "none",
        borderRadius: "6px",
      },
    },
    label,
  );

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
