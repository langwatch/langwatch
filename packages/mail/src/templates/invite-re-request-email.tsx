import { z } from "zod";
import { sendEmail } from "../email-sender";
import type { EmailDeliveryPort } from "../providers/types";
import { EmailLayout, Paragraph, PrimaryButton } from "./email-layout";
import { defineTemplate, renderMailTemplate } from "./registry";

/**
 * "The person you invited says their link expired" (D11).
 *
 * Sent to the admins who can act on it, never to the invitee — the invitee's
 * side of this is a screen that says the request went out. The mail carries
 * no link of its own: a fresh invitation is minted by an admin resending
 * from the members table, which is the one path that rotates the code and
 * revokes the stale one. A "resend it for them" link in mail would be a
 * second, unauthenticated way to mint a bearer token.
 */
export const inviteReRequestEmailProps = z.object({
  adminEmail: z.email(),
  organizationName: z.string().min(1),
  invitedEmail: z.email(),
  membersSettingsUrl: z.url(),
});

export type InviteReRequestEmailProps = z.infer<typeof inviteReRequestEmailProps>;

export const inviteReRequestEmailSubject = ({
  invitedEmail,
  organizationName,
}: InviteReRequestEmailProps): string =>
  `${invitedEmail} needs a fresh invitation to ${organizationName}`;

export const InviteReRequestEmail = ({
  organizationName,
  invitedEmail,
  membersSettingsUrl,
}: InviteReRequestEmailProps) => (
  <EmailLayout
    eyebrow="INVITATION"
    preview={`${invitedEmail} asked for a new invitation`}
    heading="An invitation expired"
    footNote="You are receiving this because you can invite people to this organization."
  >
    <Paragraph>
      <strong>{invitedEmail}</strong> tried to accept their invitation to{" "}
      <strong>{organizationName}</strong> on LangWatch, but it had already expired. They asked for a
      new one.
    </Paragraph>
    <Paragraph>
      Resending takes one click and sends them a fresh link. The expired one stops working when you
      do.
    </Paragraph>
    <PrimaryButton href={membersSettingsUrl}>Open members settings</PrimaryButton>
    <Paragraph>
      If you did not mean to invite them, you can ignore this — their expired link already does
      nothing.
    </Paragraph>
  </EmailLayout>
);

export const inviteReRequestEmailTemplate = defineTemplate({
  id: "invite-re-request",
  title: "An invitation expired",
  sentWhen: "Somebody with an expired invitation asks for a new one. Sent to the admins.",
  schema: inviteReRequestEmailProps,
  subject: inviteReRequestEmailSubject,
  Component: InviteReRequestEmail,
  fixtures: {
    default: {
      adminEmail: "priya@acme.example",
      organizationName: "Acme Corp",
      invitedEmail: "morgan@acme.example",
      membersSettingsUrl: "https://app.langwatch.ai/settings/members",
    },
  },
});

export const sendInviteReRequestEmail = async ({
  mailer,
  ...props
}: InviteReRequestEmailProps & { mailer: EmailDeliveryPort }) => {
  const { subject, html } = await renderMailTemplate(inviteReRequestEmailTemplate, props);
  await sendEmail({ mailer, content: { to: props.adminEmail, subject, html } });
};
