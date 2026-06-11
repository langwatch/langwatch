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
  /** When present, these addresses are delivered as BCC — they don't appear
   *  in the rendered message headers. Used by the trigger sender so
   *  recipients can't enumerate each other. */
  bcc?: string | string[];
  /** Optional `Reply-To` header. Lets the To: be a no-reply while still
   *  routing inbound replies somewhere useful. */
  replyTo?: string;
  /** Extra MIME headers (e.g. `List-Unsubscribe`). Passed through to whichever
   *  provider is active. SES needs SendRawEmail to carry custom headers, so a
   *  send with non-empty `headers` always takes the raw-MIME path. */
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
};

function toArray(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

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

export const computeDefaultFrom = (): string => {
  if (env.EMAIL_DEFAULT_FROM) return env.EMAIL_DEFAULT_FROM;
  const hostname = extractHostname(env.BASE_HOST ?? "");
  if (
    hostname.includes("app.langwatch.ai") ||
    hostname.includes("localhost")
  ) {
    return "LangWatch <contact@langwatch.ai>";
  }
  return `LangWatch <mailer@${hostname}>`;
};

export const sendEmail = async (content: EmailContent) => {
  if (!env.SENDGRID_API_KEY && !(env.USE_AWS_SES && env.AWS_REGION)) {
    logger.error("No email sending method available. Skipping email sending.");
    throw new Error(
      "No email sending method available. Skipping email sending.",
    );
  }

  const defaultFrom = computeDefaultFrom();

  if (env.USE_AWS_SES && env.AWS_REGION) {
    return await sendWithSES(content, defaultFrom);
  } else if (env.SENDGRID_API_KEY) {
    return await sendWithSendGrid(content, defaultFrom);
  }
};

const sanitizeHeaderValue = (value: string): string =>
  value.replace(/[\r\n]+/g, " ").trim();

const sanitizeHeaderParam = (value: string): string =>
  sanitizeHeaderValue(value).replace(/(["\\])/g, "\\$1");

const buildRawMimeMessage = ({
  from,
  to,
  replyTo,
  subject,
  html,
  headers,
  attachments,
}: {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
  attachments: EmailAttachment[];
}): string => {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const lines = [
    `From: ${sanitizeHeaderValue(from)}`,
    `To: ${to.map(sanitizeHeaderValue).join(", ")}`,
    ...(replyTo ? [`Reply-To: ${sanitizeHeaderValue(replyTo)}`] : []),
    ...Object.entries(headers ?? {}).map(
      ([name, value]) =>
        `${sanitizeHeaderValue(name)}: ${sanitizeHeaderValue(value)}`,
    ),
    `Subject: ${sanitizeHeaderValue(subject)}`,
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
      `Content-Type: ${sanitizeHeaderValue(attachment.contentType)}; name="${sanitizeHeaderParam(attachment.filename)}"`,
      `Content-Disposition: attachment; filename="${sanitizeHeaderParam(attachment.filename)}"`,
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
  const toAddresses = toArray(content.to);
  const bccAddresses = toArray(content.bcc);
  const replyToAddresses = content.replyTo ? [content.replyTo] : undefined;

  const hasCustomHeaders =
    content.headers != null && Object.keys(content.headers).length > 0;

  try {
    if (
      (content.attachments && content.attachments.length > 0) ||
      hasCustomHeaders
    ) {
      // BCC recipients are NOT written into the MIME headers — SES uses the
      // envelope `Destinations` from `SendRawEmail` to deliver them invisibly,
      // so `buildRawMimeMessage` intentionally receives no bcc and renders no
      // `Bcc:` header. Recipients only see the public To list. Custom headers
      // (List-Unsubscribe) also force this raw path — SendEmail can't carry
      // arbitrary headers.
      const rawMessage = buildRawMimeMessage({
        from,
        to: toAddresses,
        replyTo: content.replyTo,
        subject: content.subject,
        html: content.html,
        headers: content.headers,
        attachments: content.attachments ?? [],
      });

      // SES routes envelope to `Destinations`, which is the union of
      // To/Cc/Bcc — the MIME headers above do NOT carry a Bcc line, so
      // recipients only see the public To list. This is the canonical way
      // to BCC through SendRawEmail.
      const allDestinations = [...toAddresses, ...bccAddresses];
      const command = new SendRawEmailCommand({
        RawMessage: { Data: new TextEncoder().encode(rawMessage) },
        Destinations: allDestinations,
      });
      const data = await sesClient.send(command);
      logger.info(
        { messageId: data.MessageId, recipientCount: allDestinations.length },
        "Email with attachments sent successfully",
      );
      return data;
    }

    const command = new SendEmailCommand({
      Destination: {
        ToAddresses: toAddresses,
        ...(bccAddresses.length > 0 ? { BccAddresses: bccAddresses } : {}),
      },
      Message: {
        Body: { Html: { Charset: "UTF-8", Data: content.html } },
        Subject: { Charset: "UTF-8", Data: content.subject },
      },
      Source: from,
      ...(replyToAddresses ? { ReplyToAddresses: replyToAddresses } : {}),
    });
    const data = await sesClient.send(command);
    logger.info(
      { messageId: data.MessageId, recipientCount: toAddresses.length },
      "Email sent successfully",
    );
    return data;
  } catch (error) {
    logger.error({ error }, "Error sending email with SES");
    throw error;
  }
};

const sendWithSendGrid = async (content: EmailContent, defaultFrom: string) => {
  sgMail.setApiKey(env.SENDGRID_API_KEY ?? "");

  const bccAddresses = toArray(content.bcc);

  const msg = {
    to: content.to,
    from: content.from ?? defaultFrom,
    subject: content.subject,
    html: content.html,
    ...(bccAddresses.length > 0 && { bcc: bccAddresses }),
    ...(content.replyTo && { replyTo: content.replyTo }),
    ...(content.headers &&
      Object.keys(content.headers).length > 0 && {
        headers: content.headers,
      }),
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
