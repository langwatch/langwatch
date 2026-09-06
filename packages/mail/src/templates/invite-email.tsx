import { z } from "zod";
import { sendEmail } from "../email-sender";
import type { EmailDeliveryPort } from "../providers/types";
import { EmailLayout, Paragraph, PrimaryButton } from "./email-layout";
import { defineTemplate, renderMailTemplate } from "./registry";

export const inviteEmailProps = z.object({
  email: z.email().describe("The address the invitation was addressed to"),
  /** Only the name is rendered, so the row is narrowed to it. */
  organization: z.object({ name: z.string().min(1) }),
  /**
   * The link the invitation carries, already built.
   *
   * Passed in rather than derived from an invite code here: the same URL is
   * returned by the invitation listing so a deployment with no mail gateway can
   * hand the invitation over some other way, and one builder is what keeps the
   * two from drifting.
   */
  acceptInviteUrl: z.url(),
});

export type InviteEmailProps = z.infer<typeof inviteEmailProps>;

export const inviteEmailSubject = ({ organization }: InviteEmailProps): string =>
  `You were added to ${organization.name} on LangWatch`;

export const InviteEmail = ({ email, organization, acceptInviteUrl }: InviteEmailProps) => (
  <EmailLayout
    eyebrow="INVITATION"
    preview={`Join ${organization.name} on LangWatch`}
    heading={`You have been invited to ${organization.name}`}
  >
    <Paragraph>
      You have been invited to join <strong>{organization.name}</strong> on LangWatch. Accept below
      to create your account, or sign in with <strong>{email}</strong> if you already have one.
    </Paragraph>
    <PrimaryButton href={acceptInviteUrl}>Accept invitation</PrimaryButton>
    <Paragraph>If this was a mistake, you can safely ignore this email.</Paragraph>
  </EmailLayout>
);

export const inviteEmailTemplate = defineTemplate({
  id: "invite",
  title: "Invitation to an organization",
  sentWhen: "An admin invites somebody to their organization.",
  schema: inviteEmailProps,
  subject: inviteEmailSubject,
  Component: InviteEmail,
  fixtures: {
    default: {
      email: "morgan@acme.example",
      organization: { name: "Acme Corp" },
      acceptInviteUrl: "https://app.langwatch.ai/invite/inv_8f2c41ab9d",
    },
    "long organization name": {
      email: "morgan@northwind-logistics.example",
      organization: { name: "Northwind Logistics and Freight Group" },
      acceptInviteUrl: "https://app.langwatch.ai/invite/inv_3b71ee05c4",
    },
  },
});

export const sendInviteEmail = async ({
  mailer,
  ...props
}: InviteEmailProps & { mailer: EmailDeliveryPort }) => {
  const { subject, html } = await renderMailTemplate(inviteEmailTemplate, props);
  await sendEmail({ mailer, content: { to: props.email, subject, html } });
};
