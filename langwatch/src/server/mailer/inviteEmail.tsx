import { render } from "@react-email/render";
import { Html } from "@react-email/html";
import { Button } from "@react-email/button";
import { Container } from "@react-email/container";
import { Heading } from "@react-email/heading";
import { Img } from "@react-email/img";
import { env } from "../../env.mjs";
import type { Organization } from "@prisma/client";
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
  const acceptInviteUrl = `${env.BASE_HOST}/invite/accept?inviteCode=${inviteCode}`;

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
        <Img
          src="https://app.langwatch.ai/images/logo-icon.png"
          alt="LangWatch Logo"
          width="36"
        />
        <Heading as="h1">LangWatch Invite</Heading>
        <p>
          You have been invited to join the <strong>{organization.name}</strong>
          Organization on LangWatch. Please click the button below to create your
          account or login with the email <b>{email}</b>:
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
    </Html>
  );

  await sendEmail({
    to: email,
    subject: `You were added to ${organization.name} on LangWatch`,
    html: emailHtml,
  });
};
