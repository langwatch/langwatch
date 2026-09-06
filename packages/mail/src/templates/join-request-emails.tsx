import { z } from "zod";
import { sendEmail } from "../email-sender";
import type { EmailDeliveryPort } from "../providers/types";
import { EmailLayout, Paragraph, PrimaryButton } from "./email-layout";
import { defineTemplate, renderMailTemplate } from "./registry";

/**
 * The six join-request emails (D12).
 *
 * Two rules run through all of them.
 *
 * No mail carries an action link that decides anything. An admin approves in
 * the members area, behind their session; a link in mail that approved a
 * request would be a second, unauthenticated way to add somebody to an
 * organization — the same reason D11's re-request mail carries no "resend it
 * for them" link.
 *
 * And a rejection says nothing about why, and does not name who said no. The
 * ending is deliberately quiet: an admin who has to justify a refusal is an
 * admin who hesitates to make one, and a requester who learns which colleague
 * turned them down has learned something that is not theirs.
 */

const adminNotice = "You are receiving this because you administer this organization.";

/* ── Somebody on the company domain is waiting. Sent to every admin. ─────── */

export const joinRequestArrivedProps = z.object({
  adminEmail: z.email(),
  organizationName: z.string().min(1),
  requesterName: z.string().min(1),
  domain: z.string().min(1),
  membersSettingsUrl: z.url(),
});

export type JoinRequestArrivedProps = z.infer<typeof joinRequestArrivedProps>;

export const joinRequestArrivedSubject = ({
  requesterName,
  organizationName,
}: JoinRequestArrivedProps): string => `${requesterName} asked to join ${organizationName}`;

export const JoinRequestArrivedEmail = ({
  organizationName,
  requesterName,
  domain,
  membersSettingsUrl,
}: JoinRequestArrivedProps) => (
  <EmailLayout
    preview={`${requesterName} asked to join ${organizationName}`}
    heading="Someone asked to join your organization"
    footNote={adminNotice}
  >
    <Paragraph>
      <strong>{requesterName}</strong> has a verified <strong>{domain}</strong> address and asked to
      join <strong>{organizationName}</strong> on LangWatch.
    </Paragraph>
    <Paragraph>
      Approving adds them with your organization&apos;s default role. If they need more than that,
      send them an invitation instead — that is the flow that carries roles and teams.
    </Paragraph>
    <PrimaryButton href={membersSettingsUrl}>Open members settings</PrimaryButton>
    <Paragraph>If nobody answers, the request lapses on its own after two weeks.</Paragraph>
  </EmailLayout>
);

export const joinRequestArrivedTemplate = defineTemplate({
  id: "join-request-arrived",
  title: "Someone asked to join",
  sentWhen: "Somebody on the organization's domain asks to join. Sent to every admin.",
  schema: joinRequestArrivedProps,
  subject: joinRequestArrivedSubject,
  Component: JoinRequestArrivedEmail,
  fixtures: {
    default: {
      adminEmail: "priya@acme.example",
      organizationName: "Acme Corp",
      requesterName: "Morgan Ellis",
      domain: "acme.example",
      membersSettingsUrl: "https://app.langwatch.ai/settings/members",
    },
  },
});

export const sendJoinRequestArrivedEmail = async ({
  mailer,
  ...props
}: JoinRequestArrivedProps & { mailer: EmailDeliveryPort }) => {
  const { subject, html } = await renderMailTemplate(joinRequestArrivedTemplate, props);
  await sendEmail({ mailer, content: { to: props.adminEmail, subject, html } });
};

/* ── The one nudge, on the seventh day. ──────────────────────────────────── */

export const joinRequestReminderProps = z.object({
  organizationName: z.string().min(1),
  requesterName: z.string().min(1),
  membersSettingsUrl: z.url(),
});

export type JoinRequestReminderProps = z.infer<typeof joinRequestReminderProps>;

/** The subject the reminder carries, wherever it is sent from. */
export const joinRequestReminderSubject = ({
  organizationName,
  requesterName,
}: JoinRequestReminderProps): string =>
  `${requesterName} is still waiting to join ${organizationName}`;

export const JoinRequestReminderEmail = ({
  organizationName,
  requesterName,
  membersSettingsUrl,
}: JoinRequestReminderProps) => (
  <EmailLayout
    preview={`${requesterName} is still waiting`}
    heading="A request to join is still waiting"
    footNote={adminNotice}
  >
    <Paragraph>
      <strong>{requesterName}</strong> asked to join <strong>{organizationName}</strong> a week ago
      and nobody has answered yet.
    </Paragraph>
    <Paragraph>It lapses in another week. This is the only reminder we send about it.</Paragraph>
    <PrimaryButton href={membersSettingsUrl}>Open members settings</PrimaryButton>
  </EmailLayout>
);

export const joinRequestReminderTemplate = defineTemplate({
  id: "join-request-reminder",
  title: "A request to join is still waiting",
  sentWhen: "Seven days after a join request nobody has answered. Sent to every admin.",
  schema: joinRequestReminderProps,
  subject: joinRequestReminderSubject,
  Component: JoinRequestReminderEmail,
  fixtures: {
    default: {
      organizationName: "Acme Corp",
      requesterName: "Morgan Ellis",
      membersSettingsUrl: "https://app.langwatch.ai/settings/members",
    },
  },
});

/**
 * Rendered only, and separated from the send because a process that owns its
 * own envelope still has to send exactly these words. The worker holds the mail
 * gateway and the deployment's host; what it must not hold is a second copy of
 * the message, which is what put react-email on its boot graph and let two
 * admins on one organization receive two differently-worded reminders.
 */
export const renderJoinRequestReminderEmail = async (
  props: JoinRequestReminderProps,
): Promise<string> => (await renderMailTemplate(joinRequestReminderTemplate, props)).html;

export const sendJoinRequestReminderEmail = async ({
  mailer,
  adminEmail,
  ...props
}: JoinRequestReminderProps & { mailer: EmailDeliveryPort; adminEmail: string }) => {
  const { subject, html } = await renderMailTemplate(joinRequestReminderTemplate, props);
  await sendEmail({ mailer, content: { to: adminEmail, subject, html } });
};

/* ── You are in. Sent to the requester. ──────────────────────────────────── */

export const joinRequestApprovedProps = z.object({
  requesterEmail: z.email(),
  organizationName: z.string().min(1),
  organizationUrl: z.url(),
});

export type JoinRequestApprovedProps = z.infer<typeof joinRequestApprovedProps>;

export const joinRequestApprovedSubject = ({
  organizationName,
}: JoinRequestApprovedProps): string => `You are now a member of ${organizationName}`;

export const JoinRequestApprovedEmail = ({
  organizationName,
  organizationUrl,
}: JoinRequestApprovedProps) => (
  <EmailLayout
    preview={`Your request to join ${organizationName} was approved`}
    heading={`You are in ${organizationName}`}
  >
    <Paragraph>
      Your request to join <strong>{organizationName}</strong> on LangWatch was approved. You are a
      member now, with the organization&apos;s default role.
    </Paragraph>
    <PrimaryButton href={organizationUrl}>Open {organizationName}</PrimaryButton>
  </EmailLayout>
);

export const joinRequestApprovedTemplate = defineTemplate({
  id: "join-request-approved",
  title: "Your request was approved",
  sentWhen: "An admin approves a join request. Sent to the requester.",
  schema: joinRequestApprovedProps,
  subject: joinRequestApprovedSubject,
  Component: JoinRequestApprovedEmail,
  fixtures: {
    default: {
      requesterEmail: "morgan@acme.example",
      organizationName: "Acme Corp",
      organizationUrl: "https://app.langwatch.ai/acme-corp",
    },
  },
});

export const sendJoinRequestApprovedEmail = async ({
  mailer,
  ...props
}: JoinRequestApprovedProps & { mailer: EmailDeliveryPort }) => {
  const { subject, html } = await renderMailTemplate(joinRequestApprovedTemplate, props);
  await sendEmail({ mailer, content: { to: props.requesterEmail, subject, html } });
};

/* ── It was not approved. No reason, nobody named. ───────────────────────── */

export const joinRequestRejectedProps = z.object({
  requesterEmail: z.email(),
  organizationName: z.string().min(1),
});

export type JoinRequestRejectedProps = z.infer<typeof joinRequestRejectedProps>;

export const joinRequestRejectedSubject = ({
  organizationName,
}: JoinRequestRejectedProps): string => `Your request to join ${organizationName} was not approved`;

export const JoinRequestRejectedEmail = ({ organizationName }: JoinRequestRejectedProps) => (
  <EmailLayout
    preview={`Your request to join ${organizationName} was not approved`}
    heading="Your request was not approved"
  >
    <Paragraph>
      Your request to join <strong>{organizationName}</strong> on LangWatch was not approved.
    </Paragraph>
    <Paragraph>
      If you think that is a mistake, the people who can change it are your colleagues there — ask
      one of them for an invitation.
    </Paragraph>
  </EmailLayout>
);

export const joinRequestRejectedTemplate = defineTemplate({
  id: "join-request-rejected",
  title: "Your request was not approved",
  sentWhen: "An admin declines a join request. Sent to the requester, without a reason.",
  schema: joinRequestRejectedProps,
  subject: joinRequestRejectedSubject,
  Component: JoinRequestRejectedEmail,
  fixtures: {
    default: { requesterEmail: "morgan@acme.example", organizationName: "Acme Corp" },
  },
});

export const sendJoinRequestRejectedEmail = async ({
  mailer,
  ...props
}: JoinRequestRejectedProps & { mailer: EmailDeliveryPort }) => {
  const { subject, html } = await renderMailTemplate(joinRequestRejectedTemplate, props);
  await sendEmail({ mailer, content: { to: props.requesterEmail, subject, html } });
};

/* ── Nobody answered in time. ────────────────────────────────────────────── */

export const joinRequestExpiredProps = z.object({ organizationName: z.string().min(1) });

export type JoinRequestExpiredProps = z.infer<typeof joinRequestExpiredProps>;

/** The subject the lapse notice carries, wherever it is sent from. */
export const joinRequestExpiredSubject = ({ organizationName }: JoinRequestExpiredProps): string =>
  `Your request to join ${organizationName} lapsed`;

export const JoinRequestExpiredEmail = ({ organizationName }: JoinRequestExpiredProps) => (
  <EmailLayout
    preview={`Your request to join ${organizationName} lapsed`}
    heading="Your request lapsed"
  >
    <Paragraph>
      Nobody answered your request to join <strong>{organizationName}</strong> on LangWatch within
      two weeks, so it lapsed.
    </Paragraph>
    <Paragraph>You can ask again whenever you like.</Paragraph>
  </EmailLayout>
);

export const joinRequestExpiredTemplate = defineTemplate({
  id: "join-request-expired",
  title: "Your request lapsed",
  sentWhen: "Two weeks after a join request nobody answered. Sent to the requester.",
  schema: joinRequestExpiredProps,
  subject: joinRequestExpiredSubject,
  Component: JoinRequestExpiredEmail,
  fixtures: { default: { organizationName: "Acme Corp" } },
});

/** Rendered only. See the reminder above for why the render and the send split. */
export const renderJoinRequestExpiredEmail = async (
  props: JoinRequestExpiredProps,
): Promise<string> => (await renderMailTemplate(joinRequestExpiredTemplate, props)).html;

export const sendJoinRequestExpiredEmail = async ({
  mailer,
  requesterEmail,
  ...props
}: JoinRequestExpiredProps & { mailer: EmailDeliveryPort; requesterEmail: string }) => {
  const { subject, html } = await renderMailTemplate(joinRequestExpiredTemplate, props);
  await sendEmail({ mailer, content: { to: requesterEmail, subject, html } });
};

/* ── A colleague walked straight in on the domain setting. ───────────────── */

/**
 * Sent to every admin, after the fact and straight away — a surprising join has
 * to be visible the moment it happens, which is the whole price of admitting
 * somebody with nobody in the loop.
 */
export const domainAutoJoinedProps = z.object({
  adminEmail: z.email(),
  organizationName: z.string().min(1),
  memberName: z.string().min(1),
  domain: z.string().min(1),
  membersSettingsUrl: z.url(),
});

export type DomainAutoJoinedProps = z.infer<typeof domainAutoJoinedProps>;

export const domainAutoJoinedSubject = ({
  memberName,
  organizationName,
}: DomainAutoJoinedProps): string => `${memberName} joined ${organizationName} automatically`;

export const DomainAutoJoinedEmail = ({
  organizationName,
  memberName,
  domain,
  membersSettingsUrl,
}: DomainAutoJoinedProps) => (
  <EmailLayout
    preview={`${memberName} joined ${organizationName} automatically`}
    heading="A colleague joined automatically"
    footNote={adminNotice}
  >
    <Paragraph>
      <strong>{memberName}</strong> verified a <strong>{domain}</strong> address and joined{" "}
      <strong>{organizationName}</strong> on LangWatch with the organization&apos;s default role.
    </Paragraph>
    <Paragraph>
      They were admitted by your automatic joining setting for that domain, not by anybody clicking
      approve. You can change that setting, or remove them, from members settings.
    </Paragraph>
    <PrimaryButton href={membersSettingsUrl}>Open members settings</PrimaryButton>
  </EmailLayout>
);

export const domainAutoJoinedTemplate = defineTemplate({
  id: "domain-auto-joined",
  title: "A colleague joined automatically",
  sentWhen: "Automatic domain joining admits somebody. Sent to every admin, straight away.",
  schema: domainAutoJoinedProps,
  subject: domainAutoJoinedSubject,
  Component: DomainAutoJoinedEmail,
  fixtures: {
    default: {
      adminEmail: "priya@acme.example",
      organizationName: "Acme Corp",
      memberName: "Morgan Ellis",
      domain: "acme.example",
      membersSettingsUrl: "https://app.langwatch.ai/settings/members",
    },
  },
});

export const sendDomainAutoJoinedEmail = async ({
  mailer,
  ...props
}: DomainAutoJoinedProps & { mailer: EmailDeliveryPort }) => {
  const { subject, html } = await renderMailTemplate(domainAutoJoinedTemplate, props);
  await sendEmail({ mailer, content: { to: props.adminEmail, subject, html } });
};
