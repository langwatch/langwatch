import {
  SESClient,
  SendEmailCommand,
  SendRawEmailCommand,
} from "@aws-sdk/client-ses";
import sgMail from "@sendgrid/mail";
import { env } from "../../env.mjs";
import { createLogger } from "../../utils/logger/server";

const logger = createLogger("langwatch:mailer:emailSender");

export type EmailAttachment = {
  filename: string;
  content: string;
  contentType: string;
};

type EmailContent = {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  attachments?: EmailAttachment[];
};

const extractHostname = (baseHost: string): string => {
  // Try to parse as URL first
  try {
    const url = new URL(baseHost);
    return url.hostname;
  } catch {
    // Fallback: strip protocol and extract hostname manually
    const withoutProtocol = baseHost.replace(/^[a-z]+:\/\//i, "");
    const hostname = withoutProtocol.split("/")[0]?.trim() ?? "";
    return hostname !== "" ? hostname : "localhost";
  }
};

export const sendEmail = async (content: EmailContent) => {
  if (!env.SENDGRID_API_KEY && !(env.USE_AWS_SES && env.AWS_REGION)) {
    logger.error("No email sending method available. Skipping email sending.");
    throw new Error(
      "No email sending method available. Skipping email sending.",
    );
  }

  const defaultFrom =
    env.EMAIL_DEFAULT_FROM ??
    (() => {
      const hostname = extractHostname(env.BASE_HOST);
      if (
        hostname.includes("app.langwatch.ai") ||
        hostname.includes("localhost")
      ) {
        return "LangWatch <contact@langwatch.ai>";
      }
      return `LangWatch <mailer@${hostname}>`;
    })();

  if (env.USE_AWS_SES && env.AWS_REGION) {
    return await sendWithSES(content, defaultFrom);
  } else if (env.SENDGRID_API_KEY) {
    return await sendWithSendGrid(content, defaultFrom);
  }
};

const buildRawMimeMessage = ({
  from,
  to,
  subject,
  html,
  attachments,
}: {
  from: string;
  to: string[];
  subject: string;
  html: string;
  attachments: EmailAttachment[];
}): string => {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const lines = [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    html,
  ];

  for (const attachment of attachments) {
    const base64Content = Buffer.from(attachment.content).toString("base64");
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      base64Content,
    );
  }

  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
};

const sendWithSES = async (content: EmailContent, defaultFrom: string) => {
  logger.info("Sending email using AWS SES");
  const sesClient = new SESClient({ region: env.AWS_REGION });
  const from = content.from ?? defaultFrom;
  const toAddresses = Array.isArray(content.to) ? content.to : [content.to];

  try {
    if (content.attachments && content.attachments.length > 0) {
      const rawMessage = buildRawMimeMessage({
        from,
        to: toAddresses,
        subject: content.subject,
        html: content.html,
        attachments: content.attachments,
      });

      const command = new SendRawEmailCommand({
        RawMessage: { Data: new TextEncoder().encode(rawMessage) },
      });
      const data = await sesClient.send(command);
      logger.info({ data }, "Email with attachments sent successfully");
      return data;
    }

    const command = new SendEmailCommand({
      Destination: { ToAddresses: toAddresses },
      Message: {
        Body: { Html: { Charset: "UTF-8", Data: content.html } },
        Subject: { Charset: "UTF-8", Data: content.subject },
      },
      Source: from,
    });
    const data = await sesClient.send(command);
    logger.info({ data }, "Email sent successfully");
    return data;
  } catch (error) {
    logger.error({ error }, "Error sending email with SES");
    throw error;
  }
};

const sendWithSendGrid = async (content: EmailContent, defaultFrom: string) => {
  sgMail.setApiKey(env.SENDGRID_API_KEY ?? "");

  const msg = {
    to: content.to,
    from: content.from ?? defaultFrom,
    subject: content.subject,
    html: content.html,
    ...(content.attachments &&
      content.attachments.length > 0 && {
        attachments: content.attachments.map((att) => ({
          content: Buffer.from(att.content).toString("base64"),
          filename: att.filename,
          type: att.contentType,
          disposition: "attachment" as const,
        })),
      }),
  };

  try {
    return await sgMail.send(msg);
  } catch (error) {
    logger.error({ error }, "Error sending email with SendGrid");
    throw error;
  }
};
