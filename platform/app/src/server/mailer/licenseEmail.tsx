import { render } from "@react-email/render";
import {
  EmailFacts,
  EmailFinePrint,
  EmailParagraph,
  EmailSectionHeading,
  EmailShell,
  emailLinkStyle,
} from "./emailLayout";
import { sendEmail } from "./emailSender";
import {
  EMAIL_COLOR,
  EMAIL_FONT,
  EMAIL_RADIUS,
  EMAIL_TYPE,
} from "./emailTheme";

interface SendLicenseEmailParams {
  email: string;
  licenseKey: string;
  planType: string;
  maxMembers: number;
  expiresAt: string;
  organizationName: string;
}

/**
 * Sanitize a string for safe use as a filename prefix.
 * Strips path separators, null bytes, and other filesystem-unsafe characters.
 * Replaces dots with underscores to avoid confusing file extension parsing.
 */
function sanitizeFilenamePrefix(name: string): string {
  return name
    .replace(/[/\\:\0*?"<>|]/g, "") // remove filesystem-unsafe chars
    .replace(/\./g, "_") // replace dots to avoid extension confusion
    .replace(/\s+/g, "_") // collapse whitespace to underscores
    .trim()
    .slice(0, 100); // limit length
}

export const sendLicenseEmail = async ({
  email,
  licenseKey,
  planType,
  maxMembers,
  expiresAt,
  organizationName,
}: SendLicenseEmailParams) => {
  const expirationDate = new Date(expiresAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const emailHtml = await render(
    <EmailShell
      title="Your LangWatch License"
      footer={
        <EmailFinePrint>
          If you have any questions, please contact us at{" "}
          <a href="mailto:support@langwatch.ai" style={emailLinkStyle}>
            support@langwatch.ai
          </a>
        </EmailFinePrint>
      }
    >
      <EmailParagraph>
        Thank you for purchasing a LangWatch license! Your license details:
      </EmailParagraph>
      <EmailFacts
        rows={[
          {
            label: "Plan",
            value:
              planType.charAt(0).toUpperCase() +
              planType.slice(1).toLowerCase(),
          },
          { label: "Seats", value: maxMembers },
          { label: "Expires", value: expirationDate },
        ]}
      />

      <EmailSectionHeading>How to activate</EmailSectionHeading>
      <EmailParagraph>
        A <code style={codeStyle}>.langwatch-license</code> file is attached to
        this email. To activate your license:
      </EmailParagraph>
      <ol style={listStyle}>
        <li style={listItemStyle}>
          Go to <strong>Settings → License</strong> in your LangWatch instance
        </li>
        <li style={listItemStyle}>
          Upload the attached file or paste the license key below
        </li>
      </ol>

      <EmailSectionHeading>License Key</EmailSectionHeading>
      <EmailParagraph tone="muted" style={{ marginBottom: "8px" }}>
        You can also copy and paste this key directly:
      </EmailParagraph>
      <pre style={keyBlockStyle}>{licenseKey}</pre>
    </EmailShell>,
  );

  await sendEmail({
    to: email,
    subject: "Your LangWatch License Key",
    html: emailHtml,
    attachments: [
      {
        filename: `${sanitizeFilenamePrefix(organizationName)}.langwatch-license`,
        content: licenseKey,
        contentType: "application/octet-stream",
      },
    ],
  });
};

/** A filename inside a sentence: the mono face, and no box around it. */
const codeStyle = {
  fontFamily: EMAIL_FONT.mono,
  fontSize: "13.5px",
  color: EMAIL_COLOR.text,
} as const;

const listStyle = {
  margin: "0 0 16px 0",
  paddingLeft: "20px",
  fontSize: EMAIL_TYPE.body.size,
  lineHeight: EMAIL_TYPE.body.leading,
  color: EMAIL_COLOR.text,
} as const;

const listItemStyle = { marginBottom: "6px" } as const;

/**
 * The key itself: a quiet field rather than the warm tint, because this is
 * something to copy exactly, not something to notice.
 */
const keyBlockStyle = {
  margin: 0,
  backgroundColor: EMAIL_COLOR.fieldBg,
  border: `1px solid ${EMAIL_COLOR.hairline}`,
  borderRadius: EMAIL_RADIUS.field,
  padding: "14px 16px",
  fontSize: "12.5px",
  lineHeight: 1.6,
  fontFamily: EMAIL_FONT.mono,
  color: EMAIL_COLOR.text,
  wordBreak: "break-all",
  whiteSpace: "pre-wrap",
  overflowWrap: "break-word",
} as const;
