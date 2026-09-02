import { Button, Container, Heading, Html, Img } from "@react-email/components";
import { render } from "@react-email/render";
import { sendEmail } from "../email-sender";
import type { EmailDeliveryPort } from "../providers/types";

export const sendInviteEmail = async ({
  mailer,
  email,
  organization,
  acceptInviteUrl,
}: {
  email: string;
  /** Only the name is rendered, so the row is narrowed to it. */
  organization: { name: string };
  /**
   * The link the invitation carries, already built.
   *
   * Passed in rather than derived from an invite code here: the same URL is
   * returned by the invitation listing so a deployment with no mail gateway can
   * hand the invitation over some other way, and one builder is what keeps the
   * two from drifting.
   */
  acceptInviteUrl: string;
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
        <Heading as="h1">LangWatch Invite</Heading>
        <p>
          You have been invited to join the <strong>{organization.name}</strong>
          Organization on LangWatch. Please click the button below to create your account or login
          with the email <b>{email}</b>:
        </p>
        <Button
          href={acceptInviteUrl}
          style={{
            padding: "10px 20px",
            color: "white",
            backgroundColor: "#ED8926",
            textDecoration: "none",
            borderRadius: "6px",
          }}
        >
          Accept Invite
        </Button>
        <p>If this is a mistake, you can safely ignore this email</p>
      </Container>
    </Html>,
  );

  await sendEmail({
    mailer,
    content: {
      to: email,
      subject: `You were added to ${organization.name} on LangWatch`,
      html: emailHtml,
    },
  });
};
