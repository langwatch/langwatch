import { render } from "@react-email/render";
import type { Organization } from "~/generated/prisma/client";
import { buildInviteAcceptUrl } from "../invites/invite-link";
import { EmailAction, EmailParagraph, EmailShell } from "./emailLayout";
import { sendEmail } from "./emailSender";

export const sendInviteEmail = async ({
  email,
  organization,
  inviteCode,
}: {
  email: string;
  organization: Organization;
  inviteCode: string;
}) => {
  const acceptInviteUrl = buildInviteAcceptUrl(inviteCode);

  const emailHtml = await render(
    <EmailShell title="LangWatch Invite">
      <EmailParagraph>
        You have been invited to join the <strong>{organization.name}</strong>{" "}
        Organization on LangWatch. Please click the button below to create your
        account or login with the email <b>{email}</b>:
      </EmailParagraph>
      <EmailAction href={acceptInviteUrl} label="Accept Invite" />
      <EmailParagraph tone="muted" style={{ margin: 0 }}>
        If this is a mistake, you can safely ignore this email
      </EmailParagraph>
    </EmailShell>,
  );

  await sendEmail({
    to: email,
    subject: `You were added to ${organization.name} on LangWatch`,
    html: emailHtml,
  });
};
