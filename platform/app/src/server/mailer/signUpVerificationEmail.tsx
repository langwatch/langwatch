import { render } from "@react-email/render";
import { EmailAction, EmailParagraph, EmailShell } from "./emailLayout";
import { sendEmail } from "./emailSender";

/**
 * The email that carries a sign-up address's confirmation link (D13,
 * ADR-117 §6: sign-up verifies the address before any sign-in method is
 * chosen, so this send is the first thing sign-up does and nothing exists for
 * the address until the link comes back).
 */
export const sendSignUpVerificationEmail = async ({
  email,
  verificationUrl,
}: {
  email: string;
  verificationUrl: string;
}) => {
  const emailHtml = await render(
    <EmailShell title="Confirm your email address">
      <EmailParagraph>
        Someone started creating a LangWatch account with this address (
        <b>{email}</b>). Click the button below to confirm it and carry on:
      </EmailParagraph>
      <EmailAction href={verificationUrl} label="Confirm my email address" />
      <EmailParagraph tone="muted" style={{ margin: 0 }}>
        This link expires in 1 hour and can be used once. If this was not you,
        you can ignore this email: nothing has been created.
      </EmailParagraph>
    </EmailShell>,
  );

  await sendEmail({
    to: email,
    subject: "Confirm your email address for LangWatch",
    html: emailHtml,
  });
};
