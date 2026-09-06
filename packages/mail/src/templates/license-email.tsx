import { z } from "zod";
import { sendEmail } from "../email-sender";
import type { EmailDeliveryPort } from "../providers/types";
import { CodeBlock, DetailTable, EmailLayout, Muted, Paragraph } from "./email-layout";
import { defineTemplate, renderMailTemplate } from "./registry";

export const licenseEmailProps = z.object({
  email: z.email(),
  licenseKey: z.string().min(1),
  planType: z.string().min(1),
  maxMembers: z.number().int().positive().describe("Seats the license covers"),
  expiresAt: z.string().min(1).describe("ISO date the license runs out"),
  organizationName: z.string().min(1),
});

export type LicenseEmailProps = z.infer<typeof licenseEmailProps>;

export const licenseEmailSubject = (): string => "Your LangWatch License Key";

const formatExpiry = (expiresAt: string): string =>
  new Date(expiresAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

const titleCase = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

export const LicenseEmail = ({
  licenseKey,
  planType,
  maxMembers,
  expiresAt,
}: LicenseEmailProps) => (
  <EmailLayout preview="Your license key and how to activate it" heading="Your LangWatch license">
    <Paragraph>Thank you for your license. Here is what it covers.</Paragraph>
    <DetailTable
      rows={[
        { label: "Plan", value: titleCase(planType) },
        { label: "Seats", value: maxMembers.toLocaleString() },
        { label: "Expires", value: formatExpiry(expiresAt) },
      ]}
    />
    <Paragraph>
      A <code>.langwatch-license</code> file is attached. Go to Settings, then License, in your
      LangWatch instance and upload it — or paste the key below.
    </Paragraph>
    <CodeBlock>{licenseKey}</CodeBlock>
    <Muted>Keep this key private. Anyone holding it can activate a LangWatch instance.</Muted>
  </EmailLayout>
);

export const licenseEmailTemplate = defineTemplate({
  id: "license",
  title: "Your LangWatch license",
  sentWhen: "A license is issued. Sent to the buyer, with the license file attached.",
  schema: licenseEmailProps,
  subject: licenseEmailSubject,
  Component: LicenseEmail,
  fixtures: {
    default: {
      email: "priya@acme.example",
      licenseKey:
        "eyJhbGciOiJFZERTQSJ9.eyJvcmciOiJBY21lIENvcnAiLCJzZWF0cyI6NTAsImV4cCI6MTc5ODc2MTYwMH0.5vQnJm2Xr9tKcAb0pWq3ZsLh8YdN1eFgUiOoRtVxCw",
      planType: "ENTERPRISE",
      maxMembers: 50,
      expiresAt: "2027-01-01T00:00:00.000Z",
      organizationName: "Acme Corp",
    },
  },
});

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
  mailer,
  ...props
}: LicenseEmailProps & { mailer: EmailDeliveryPort }) => {
  const { subject, html } = await renderMailTemplate(licenseEmailTemplate, props);
  await sendEmail({
    mailer,
    content: {
      to: props.email,
      subject,
      html,
      attachments: [
        {
          filename: `${sanitizeFilenamePrefix(props.organizationName)}.langwatch-license`,
          content: props.licenseKey,
          contentType: "application/octet-stream",
        },
      ],
    },
  });
};
