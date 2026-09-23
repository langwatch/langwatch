import { z } from "zod";

import { sendEmail } from "../email-sender.ts";
import type { EmailDelivery } from "../providers/types.ts";
import { DataTable, EmailLayout, Paragraph, PrimaryButton } from "./email-layout.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

/**
 * Sent to admins when invitee's link expires (not to the invitee). Admins resend
 * from members table to safely rotate the code.
 */
export const inviteReRequestEmailProps = z.object({
  adminEmail: z.email(),
  organizationName: z.string().min(1),
  invitedEmail: z.email(),
  membersSettingsUrl: z.url(),
  /**
   * Seats held and ceiling, shown only when seats available (don't wall admins).
   * Negotiated ceilings not passed.
   */
  seats: z
    .object({ used: z.number().int().nonnegative(), ceiling: z.number().int().positive() })
    .optional(),
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
  seats,
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
    {seats && seats.used < seats.ceiling && (
      <DataTable
        columns={[
          { key: "used", label: "Seats used", align: "right" },
          { key: "ceiling", label: "Seats on your plan", align: "right" },
          { key: "free", label: "Free", align: "right" },
        ]}
        rows={[
          {
            key: "seats",
            cells: {
              used: seats.used.toLocaleString(),
              ceiling: seats.ceiling.toLocaleString(),
              free: (seats.ceiling - seats.used).toLocaleString(),
            },
          },
        ]}
      />
    )}
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
      seats: { used: 3, ceiling: 5 },
    },
    "no seat free": {
      adminEmail: "priya@acme.example",
      organizationName: "Acme Corp",
      invitedEmail: "morgan@acme.example",
      membersSettingsUrl: "https://app.langwatch.ai/settings/members",
      seats: { used: 5, ceiling: 5 },
    },
  },
});

export const sendInviteReRequestEmail = async ({
  mailer,
  ...props
}: InviteReRequestEmailProps & { mailer: EmailDelivery }) => {
  const { subject, html } = await renderMailTemplate(inviteReRequestEmailTemplate, props);
  await sendEmail({ mailer, content: { to: props.adminEmail, subject, html } });
};
