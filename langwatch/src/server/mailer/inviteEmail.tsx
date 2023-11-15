import sgMail from "@sendgrid/mail";
import { render } from "@react-email/render";
import { Html } from "@react-email/html";
import { Button } from "@react-email/button";
import { Container } from "@react-email/container";
import { Heading } from "@react-email/heading";
import { Img } from "@react-email/img";
import { env } from "../../env.mjs";
import type { NextApiRequest } from "next";
import type { Organization } from "@prisma/client";

export const sendInviteEmail = async ({
  req,
  email,
  organization,
  inviteCode,
}: {
  req: NextApiRequest;
  email: string;
  organization: Organization;
  inviteCode: string;
}) => {
  if (!env.SENDGRID_API_KEY) {
    console.warn("No SENDGRID_API_KEY found, skipping email sending");
    return;
  }

  sgMail.setApiKey(env.SENDGRID_API_KEY);

  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol =
    typeof forwardedProto === "string" ? forwardedProto : "https";
  const host = req.headers.host;
  const acceptInviteUrl = `${protocol}://${host}/accept-invite?inviteCode=${inviteCode}`;

  const emailHtml = render(
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
          You have been invited to join {organization.name} Organization on
          LangWatch. Please click the button below to create your account or
          login with the email <b>{email}</b>:
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
          Open Dashboard
        </Button>
        <p>If this is a mistake, you can safely ignore this email</p>
      </Container>
    </Html>
  );

  const msg = {
    to: email,
    from: "LangWatch <contact@langwatch.ai>",
    subject: `You were added to ${organization.name} on Langwatch`,
    html: emailHtml,
  };

  await sgMail.send(msg);
};
