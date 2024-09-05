import sgMail from "@sendgrid/mail";
import { render } from "@react-email/render";
import { Html } from "@react-email/html";
import { Button } from "@react-email/button";
import { Container } from "@react-email/container";
import { Heading } from "@react-email/heading";
import { Img } from "@react-email/img";
import { env } from "../../env.mjs";
import type { Organization } from "@prisma/client";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

export const sendInviteEmail = async ({
  email,
  organization,
  inviteCode,
}: {
  email: string;
  organization: Organization;
  inviteCode: string;
}) => {
  if (!env.SENDGRID_API_KEY && !(env.USE_AWS_SES && env.AWS_REGION)) {
    console.warn("No email sending method available. Skipping email sending.");
    console.warn(
      "Please set SENDGRID_API_KEY or both USE_AWS_SES and AWS_REGION."
    );
    return;
  }

  const acceptInviteUrl = `${env.BASE_HOST}/invite/accept?inviteCode=${inviteCode}`;

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

  if (env.USE_AWS_SES && env.AWS_REGION) {
    console.log("Sending email using AWS SES");
    const sesClient = new SESClient({ region: env.AWS_REGION });

    const params = {
      Destination: {
        ToAddresses: [email],
      },
      Message: {
        Body: {
          Html: {
            Charset: "UTF-8",
            Data: emailHtml,
          },
        },
        Subject: {
          Charset: "UTF-8",
          Data: `You were added to ${organization.name} on LangWatch`,
        },
      },
      Source: `no-reply@${env.BASE_HOST}`,
    };
    try {
      const command = new SendEmailCommand(params);
      const data = await sesClient.send(command);
      console.log("Email sent successfully:", data);
    } catch (error) {
      console.error("Error sending email:", error);
      throw error;
    }
  } else if (env.SENDGRID_API_KEY) {
    sgMail.setApiKey(env.SENDGRID_API_KEY);
    const msg = {
      to: email,
      from: `no-reply@${env.BASE_HOST}`,
      subject: `You were added to ${organization.name} on LangWatch`,
      html: emailHtml,
    };

    try {
      await sgMail.send(msg);
      console.log("Email sent");
    } catch (error) {
      throw error;
    }
  }
};
