import { createLogger } from "@langwatch/observability";
import sgMail from "@sendgrid/mail";
import { sanitizeHeaders } from "./mime";
import {
  type EmailContent,
  type EmailProviderPort,
  type MailerConfiguration,
  toArray,
} from "./types";

const logger = createLogger("langwatch:mailer:sendgrid");

/** SendGrid's module client has no transport lifecycle, only one process configuration. */
export class SendgridEmailProvider implements EmailProviderPort {
  readonly name = "sendgrid" as const;

  static create(configuration: MailerConfiguration["sendgrid"]): SendgridEmailProvider {
    return new SendgridEmailProvider(configuration);
  }

  private closed = false;

  private configured = false;

  private constructor(private readonly configuration: MailerConfiguration["sendgrid"]) {}

  async send({ content, defaultFrom }: { content: EmailContent; defaultFrom: string }) {
    if (this.closed) throw new Error("SendGrid email provider is closed.");
    // No proxy wiring here because none is needed: the client is axios-based,
    // and axios reads HTTP_PROXY/HTTPS_PROXY/NO_PROXY itself. Verified against
    // a logging CONNECT proxy, which saw api.sendgrid.com tunnelled through it
    // and stopped seeing it once NO_PROXY covered the domain.
    if (!this.configured) {
      sgMail.setApiKey(this.configuration.apiKey ?? "");
      this.configured = true;
    }

    const bccAddresses = toArray(content.bcc);

    // Same CRLF/header-injection hardening as the SES raw-MIME path: strip
    // line breaks from custom header names and values before they reach the
    // provider.
    const sanitizedHeaders = sanitizeHeaders(content.headers);

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
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
