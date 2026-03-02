import { Container } from "@react-email/container";
import { Heading } from "@react-email/heading";
import { Html } from "@react-email/html";
import { Img } from "@react-email/img";
import { render } from "@react-email/render";
import { sendEmail } from "./emailSender";

interface SendLicenseEmailParams {
  email: string;
  licenseKey: string;
  planType: string;
  maxMembers: number;
  expiresAt: string;
}

export const sendLicenseEmail = async ({
  email,
  licenseKey,
  planType,
  maxMembers,
  expiresAt,
}: SendLicenseEmailParams) => {
  const expirationDate = new Date(expiresAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

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
        <Heading as="h1">Your LangWatch License</Heading>
        <p>
          Thank you for purchasing a LangWatch license! Your license details:
        </p>
        <table
          style={{
            borderCollapse: "collapse",
            marginBottom: "16px",
          }}
        >
          <tr>
            <td style={{ padding: "4px 12px 4px 0", fontWeight: "bold" }}>
              Plan
            </td>
            <td style={{ padding: "4px 0" }}>
              {planType.charAt(0).toUpperCase() +
                planType.slice(1).toLowerCase()}
            </td>
          </tr>
          <tr>
            <td style={{ padding: "4px 12px 4px 0", fontWeight: "bold" }}>
              Seats
            </td>
            <td style={{ padding: "4px 0" }}>{maxMembers}</td>
          </tr>
          <tr>
            <td style={{ padding: "4px 12px 4px 0", fontWeight: "bold" }}>
              Expires
            </td>
            <td style={{ padding: "4px 0" }}>{expirationDate}</td>
          </tr>
        </table>

        <Heading as="h2" style={{ fontSize: "18px" }}>
          How to activate
        </Heading>
        <p>
          A <code>.langwatch-license</code> file is attached to this email.
          To activate your license:
        </p>
        <ol>
          <li>
            Go to <strong>Settings → License</strong> in your LangWatch
            instance
          </li>
          <li>Upload the attached file or paste the license key below</li>
        </ol>

        <Heading as="h2" style={{ fontSize: "18px" }}>
          License Key
        </Heading>
        <p style={{ fontSize: "12px", color: "#666" }}>
          You can also copy and paste this key directly:
        </p>
        <pre
          style={{
            backgroundColor: "#F2F4F8",
            padding: "12px",
            borderRadius: "6px",
            fontSize: "12px",
            fontFamily: "monospace",
            wordBreak: "break-all",
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
          }}
        >
          {licenseKey}
        </pre>

        <p style={{ fontSize: "12px", color: "#999", marginTop: "24px" }}>
          If you have any questions, please contact us at{" "}
          <a href="mailto:support@langwatch.ai">support@langwatch.ai</a>
        </p>
      </Container>
    </Html>,
  );

  await sendEmail({
    to: email,
    subject: "Your LangWatch License Key",
    html: emailHtml,
    attachments: [
      {
        filename: ".langwatch-license",
        content: licenseKey,
        contentType: "application/octet-stream",
      },
    ],
  });
};
