import { render } from "@react-email/render";
import { EmailAction, EmailParagraph, EmailShell } from "./emailLayout";
import { sendEmail } from "./emailSender";

/**
 * The email that confirms an address somebody added to an account they are
 * already signed in to (D01's ceremony, on the authentication settings page).
 *
 * Deliberately not the sign-up confirmation's copy. That one opens "someone
 * started creating a LangWatch account with this address", which is untrue
 * here and alarming to a reader whose address has just been added to an
 * account they may not know about. This one says what actually happened, and
 * what to do if it was not them — which is the whole reason the mail is worth
 * sending to an address nobody has proved yet.
 */
export const sendAddressConfirmationEmail = async ({
  email,
  verificationUrl,
}: {
  email: string;
  verificationUrl: string;
}) => {
  const emailHtml = await render(
    <EmailShell title="Confirm this email address">
      <EmailParagraph>
        This address (<b>{email}</b>) was added to a LangWatch account as a way
        to sign in. Confirm it to finish:
      </EmailParagraph>
      <EmailAction href={verificationUrl} label="Confirm this address" />
      <EmailParagraph tone="muted">
        Open the link in the same browser you added the address from — that is
        what finishes it, and it is why a forwarded link confirms nothing.
      </EmailParagraph>
      <EmailParagraph tone="muted" style={{ margin: 0 }}>
        The link expires in 15 minutes and can be used once. If this was not
        you, ignore this email: the address cannot sign anybody in until it is
        confirmed.
      </EmailParagraph>
    </EmailShell>,
  );

  await sendEmail({
    to: email,
    subject: "Confirm this email address for LangWatch",
    html: emailHtml,
  });
};
