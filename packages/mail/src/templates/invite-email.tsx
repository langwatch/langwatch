import { z } from "zod";
import { sendEmail } from "../email-sender";
import type { EmailDeliveryPort } from "../providers/types";
import { EmailLayout, Muted, Paragraph, PrimaryButton } from "./email-layout";
import { FirstSteps, firstStepsSchema } from "./onboarding/first-steps";
import { defineTemplate, renderMailTemplate } from "./registry";

export const inviteEmailProps = z.object({
  email: z.email().describe("The address the invitation was addressed to"),
  /**
   * The name, and how much is already there.
   *
   * `projectCount` is what tells an invitee the workspace is live rather than
   * empty, which is the thing they cannot otherwise know before accepting. A
   * count of zero reads as an empty room, so the line is suppressed there
   * rather than arguing against itself.
   */
  organization: z.object({
    name: z.string().min(1),
    projectCount: z.number().int().nonnegative().optional(),
  }),
  /** Who sent it, when the sender knows their name. Nothing is looked up here. */
  inviter: z.object({ name: z.string().min(1) }).optional(),
  /**
   * The link the invitation carries, already built.
   *
   * Passed in rather than derived from an invite code here: the same URL is
   * returned by the invitation listing so a deployment with no mail gateway can
   * hand the invitation over some other way, and one builder is what keeps the
   * two from drifting.
   */
  acceptInviteUrl: z.url(),
  /**
   * What to do first, in the language of why this organization came.
   *
   * The organization exists — somebody in it sent this — so the steps can
   * match what it uses LangWatch for rather than guessing.
   */
  firstSteps: firstStepsSchema.optional(),
});

export type InviteEmailProps = z.infer<typeof inviteEmailProps>;

export const inviteEmailSubject = ({ organization }: InviteEmailProps): string =>
  `You were added to ${organization.name} on LangWatch`;

/** Below this there is nothing to say, and saying it would say the opposite. */
const PROJECT_COUNT_FLOOR = 1;

export const InviteEmail = ({
  email,
  organization,
  inviter,
  acceptInviteUrl,
  firstSteps,
}: InviteEmailProps) => (
  <EmailLayout
    eyebrow="INVITATION"
    preview={`Join ${organization.name} on LangWatch`}
    heading={`You have been invited to ${organization.name}`}
  >
    <Paragraph>
      {inviter ? `${inviter.name} invited you to join ` : "You have been invited to join "}
      <strong>{organization.name}</strong> on LangWatch. Accept below to create your account, or
      sign in with <strong>{email}</strong> if you already have one.
    </Paragraph>
    <PrimaryButton href={acceptInviteUrl}>Accept invitation</PrimaryButton>
    {organization.projectCount !== undefined &&
      organization.projectCount >= PROJECT_COUNT_FLOOR && (
        <Muted>
          {organization.projectCount === 1
            ? `The team already tracks a project in ${organization.name}.`
            : `The team already tracks ${organization.projectCount.toLocaleString()} projects in ${organization.name}.`}
        </Muted>
      )}
    {firstSteps && <FirstSteps {...firstSteps} />}
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
      organization: { name: "Acme Corp", projectCount: 4 },
      inviter: { name: "Priya Nair" },
      acceptInviteUrl: "https://app.langwatch.ai/invite/inv_8f2c41ab9d",
      firstSteps: { intent: "AGENT_GOVERNANCE" },
    },
    "a workspace with nothing in it yet": {
      email: "morgan@acme.example",
      organization: { name: "Acme Corp", projectCount: 0 },
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
