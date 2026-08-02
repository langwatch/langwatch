import { createLogger } from "@langwatch/observability";
import sgMail from "@sendgrid/mail";
import { env } from "../../../env.mjs";
import { sanitizeHeaderValue } from "./mime";
import { type EmailContent, type EmailProviderPort, toArray } from "./types";

const logger = createLogger("langwatch:mailer:sendgrid");

export const sendgridProvider: EmailProviderPort = {
  name: "sendgrid",
  async send(content: EmailContent, defaultFrom: string) {
    // SendGrid's client is axios-based, which honours HTTPS_PROXY/NO_PROXY
    // from the environment on its own, so there is no proxy wiring here.
    sgMail.setApiKey(env.SENDGRID_API_KEY ?? "");

    const bccAddresses = toArray(content.bcc);

    // Same CRLF/header-injection hardening as the SES raw-MIME path: strip
    // line breaks from custom header names and values before they reach the
    // provider.
    const sanitizedHeaders =
      content.headers && Object.keys(content.headers).length > 0
        ? Object.fromEntries(
            Object.entries(content.headers).map(([name, value]) => [
              sanitizeHeaderValue(name),
              sanitizeHeaderValue(value),
            ]),
          )
        : undefined;

    const msg = {
      to: content.to,
      from: content.from ?? defaultFrom,
      subject: content.subject,
      html: content.html,
      ...(bccAddresses.length > 0 && { bcc: bccAddresses }),
      ...(content.replyTo && { replyTo: content.replyTo }),
      ...(sanitizedHeaders && {
        headers: sanitizedHeaders,
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
  },
};
