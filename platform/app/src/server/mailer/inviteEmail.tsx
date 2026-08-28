import { Button, Container, Heading, Html, Img } from "@react-email/components";
import { render } from "@react-email/render";
import type { Organization } from "~/generated/prisma/client";
import { buildInviteAcceptUrl } from "../invites/invite-link";
import { sendEmail } from "./emailSender";
import type { EmailDeliveryPort } from "./providers/types";

export const sendInviteEmail = async ({
  mailer,
  email,
  organization,
  inviteCode,
}: {
  email: string;
  organization: Organization;
  inviteCode: string;
  mailer: EmailDeliveryPort;
}) => {
  const acceptInviteUrl = buildInviteAcceptUrl(inviteCode);

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
