import { Button, Container, Heading, Html, Img } from "@react-email/components";
import { render } from "@react-email/render";
import { sendEmail } from "./emailSender";
import type { EmailDeliveryPort } from "./providers/types";

/**
 * The email that carries a sign-up address's confirmation link (D13,
 * ADR-117 §6: sign-up verifies the address before any sign-in method is
 * chosen, so this send is the first thing sign-up does and nothing exists for
 * the address until the link comes back).
 */
export const sendSignUpVerificationEmail = async ({
  mailer,
  email,
  verificationUrl,
}: {
  email: string;
  verificationUrl: string;
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
        <Heading as="h1">Confirm your email address</Heading>
        <p>
          Someone started creating a LangWatch account with this address (<b>{email}</b>). Click the
          button below to confirm it and carry on:
        </p>
        <Button
          href={verificationUrl}
          style={{
            padding: "10px 20px",
            color: "white",
            backgroundColor: "#ED8926",
            textDecoration: "none",
            borderRadius: "6px",
          }}
        >
          Confirm my email address
        </Button>
        <p>
          This link expires in 1 hour and can be used once. If this was not you, you can ignore this
          email: nothing has been created.
        </p>
      </Container>
    </Html>,
  );

  await sendEmail({
    mailer,
    content: {
      to: email,
      subject: "Confirm your email address for LangWatch",
      html: emailHtml,
    },
  });
};
