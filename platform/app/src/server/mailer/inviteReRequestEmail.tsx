import { render } from "@react-email/render";
import { EmailAction, EmailParagraph, EmailShell } from "./emailLayout";
import { sendEmail } from "./emailSender";

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
export const sendInviteReRequestEmail = async ({
  adminEmail,
  organizationName,
  invitedEmail,
  membersSettingsUrl,
}: {
  adminEmail: string;
  organizationName: string;
  invitedEmail: string;
  membersSettingsUrl: string;
}) => {
  const emailHtml = await render(
    <EmailShell title="An invitation expired">
      <EmailParagraph>
        <strong>{invitedEmail}</strong> tried to accept their invitation to{" "}
        <strong>{organizationName}</strong> on LangWatch, but it had already
        expired. They asked for a new one.
      </EmailParagraph>
      <EmailParagraph>
        Resending takes one click and sends them a fresh link. The expired one
        stops working when you do.
      </EmailParagraph>
      <EmailAction href={membersSettingsUrl} label="Open members settings" />
      <EmailParagraph tone="muted" style={{ margin: 0 }}>
        If you did not mean to invite them, you can ignore this — their expired
        link already does nothing.
      </EmailParagraph>
    </EmailShell>,
  );

  await sendEmail({
    to: adminEmail,
    subject: `${invitedEmail} needs a fresh invitation to ${organizationName}`,
    html: emailHtml,
  });
};
