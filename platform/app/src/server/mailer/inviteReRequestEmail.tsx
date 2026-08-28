import { Button, Container, Heading, Html, Img } from "@react-email/components";
import { render } from "@react-email/render";
import { sendEmail } from "./emailSender";
import type { EmailDeliveryPort } from "./providers/types";

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
  mailer,
  adminEmail,
  organizationName,
  invitedEmail,
  membersSettingsUrl,
}: {
  adminEmail: string;
  organizationName: string;
  invitedEmail: string;
  membersSettingsUrl: string;
  mailer: EmailDeliveryPort;
}) => {
  const emailHtml = await render(
    <Html lang="en" dir="ltr">
      <Container
        style={{
          border: "1px solid #F2F4F8",
          borderRadius: "10px",
          padding: "24px",
          paddingBottom: "12px",
        }}
      >
        <Img src="https://app.langwatch.ai/images/logo-icon.png" alt="LangWatch Logo" width="36" />
        <Heading as="h1">An invitation expired</Heading>
        <p>
          <strong>{invitedEmail}</strong> tried to accept their invitation to{" "}
          <strong>{organizationName}</strong> on LangWatch, but it had already expired. They asked
          for a new one.
        </p>
        <p>
          Resending takes one click and sends them a fresh link. The expired one stops working when
          you do.
        </p>
        <Button
          href={membersSettingsUrl}
          style={{
            padding: "10px 20px",
            color: "white",
            backgroundColor: "#ED8926",
            textDecoration: "none",
            borderRadius: "6px",
          }}
        >
          Open members settings
        </Button>
        <p>
          If you did not mean to invite them, you can ignore this — their expired link already does
          nothing.
        </p>
      </Container>
    </Html>,
  );

  await sendEmail({
    mailer,
    content: {
      to: adminEmail,
      subject: `${invitedEmail} needs a fresh invitation to ${organizationName}`,
      html: emailHtml,
    },
  });
};
