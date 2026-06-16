import { Button } from "@react-email/button";
import { Container } from "@react-email/container";
import { Heading } from "@react-email/heading";
import { Html } from "@react-email/html";
import { Img } from "@react-email/img";
import { render } from "@react-email/render";
import { sendEmail } from "./emailSender";

export const sendResetPasswordEmail = async ({
  email,
  resetUrl,
}: {
  email: string;
  resetUrl: string;
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
        <Img
          src="https://app.langwatch.ai/images/logo-icon.png"
          alt="LangWatch Logo"
          width="36"
        />
        <Heading as="h1">Reset your password</Heading>
        <p>
          We received a request to reset the password for your LangWatch account
          (<b>{email}</b>). Click the button below to choose a new password:
        </p>
        <Button
          href={resetUrl}
          style={{
            padding: "10px 20px",
            color: "white",
            backgroundColor: "#ED8926",
            textDecoration: "none",
            borderRadius: "6px",
          }}
        >
          Reset password
        </Button>
        <p>
          This link expires in 1 hour. If you did not request a password reset,
          you can safely ignore this email and your password will stay the same.
        </p>
      </Container>
    </Html>,
  );

  await sendEmail({
    to: email,
    subject: "Reset your LangWatch password",
    html: emailHtml,
  });
};
