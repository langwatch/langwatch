import { render } from "@react-email/render";
import { EmailParagraph, EmailShell } from "./emailLayout";
import { sendEmail } from "./emailSender";

export async function sendOrganizationMfaRequirementEmail({
  to,
  organizationName,
  actorName,
  required,
}: {
  to: string;
  organizationName: string;
  actorName: string;
  required: boolean;
}): Promise<void> {
  const title = required
    ? "Two-step verification is now required"
    : "Two-step verification is no longer required";
  const emailHtml = await render(
    <EmailShell title={title}>
      <EmailParagraph>
        {actorName} {required ? "turned on" : "turned off"} the two-step
        verification requirement for <b>{organizationName}</b>.
      </EmailParagraph>
      <EmailParagraph tone="muted" style={{ margin: 0 }}>
        {required
          ? "You will need to prove a second factor before opening this organization. Your other organizations and existing sessions are unchanged."
          : "You can open this organization without proving a second factor. Any two-step verification already set up on your account stays in place."}
      </EmailParagraph>
    </EmailShell>,
  );

  await sendEmail({
    to,
    subject: `${title} for ${organizationName}`,
    html: emailHtml,
  });
}
