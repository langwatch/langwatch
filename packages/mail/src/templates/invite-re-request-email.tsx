import { z } from "zod";
import { sendEmail } from "../email-sender";
import type { EmailDeliveryPort } from "../providers/types";
import { DataTable, EmailLayout, Paragraph, PrimaryButton } from "./email-layout";
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
  /**
   * Seats held and seats the plan covers, when the sender knows both.
   *
   * Shown only while there is a seat free. An admin about to re-send an
   * invitation is the last reader who should meet a wall, so a plan with no
   * room left says nothing here and the seat conversation happens where seats
   * are bought. A ceiling that is negotiated rather than sold is not passed at
   * all: the sender resolves both numbers for THIS organization, and answers
   * nothing where a public number would be a fiction.
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
}: InviteReRequestEmailProps & { mailer: EmailDeliveryPort }) => {
  const { subject, html } = await renderMailTemplate(inviteReRequestEmailTemplate, props);
  await sendEmail({ mailer, content: { to: props.adminEmail, subject, html } });
};
