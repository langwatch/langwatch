import { render } from "@react-email/render";
import { EmailAction, EmailParagraph, EmailShell } from "./emailLayout";
import { sendEmail } from "./emailSender";

export const sendResetPasswordEmail = async ({
  email,
  resetUrl,
}: {
  email: string;
  resetUrl: string;
}) => {
  const emailHtml = await render(
    <EmailShell title="Reset your password">
      <EmailParagraph>
        We received a request to reset the password for your LangWatch account (
        <b>{email}</b>). Click the button below to choose a new password:
      </EmailParagraph>
      <EmailAction href={resetUrl} label="Reset password" />
      <EmailParagraph tone="muted" style={{ margin: 0 }}>
        This link expires in 1 hour. If you did not request a password reset,
        you can safely ignore this email and your password will stay the same.
      </EmailParagraph>
    </EmailShell>,
  );

  await sendEmail({
    to: email,
    subject: "Reset your LangWatch password",
    html: emailHtml,
  });
};
