import { createLogger } from "@langwatch/observability";
import sgMail from "@sendgrid/mail";
import {
  type EmailContent,
  EmailGatewayPort,
  type MailerConfiguration,
} from "../ports/email-delivery.port";
import { EmailMimeService } from "../services/email-mime.service";

const logger = createLogger("langwatch:mailer:sendgrid");

/** SendGrid's module client has no transport lifecycle, only one process configuration. */
export class SendgridEmailGatewayAdapter extends EmailGatewayPort {
  static create(configuration: MailerConfiguration["sendgrid"]): SendgridEmailGatewayAdapter {
    return new SendgridEmailGatewayAdapter(configuration);
  }

  readonly name = "sendgrid" as const;

  private readonly mime = EmailMimeService.create();

  private closed = false;

  private configured = false;

  private constructor(private readonly configuration: MailerConfiguration["sendgrid"]) {
    super();
  }

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

    const bccAddresses = EmailGatewayPort.recipients(content.bcc);

    // Same CRLF/header-injection hardening as the SES raw-MIME path: strip
    // line breaks from custom header names and values before they reach the
    // provider.
    const sanitizedHeaders = this.mime.trySanitizeHeaders(content.headers);

    const message = {
      to: content.to,
      from: content.from ?? defaultFrom,
      subject: content.subject,
      html: content.html,
      ...(bccAddresses.length > 0 && { bcc: bccAddresses }),
      ...(content.replyTo && { replyTo: content.replyTo }),
      ...(sanitizedHeaders && { headers: sanitizedHeaders }),
      ...(content.attachments &&
        content.attachments.length > 0 && {
          attachments: content.attachments.map((attachment) => ({
            content: Buffer.from(attachment.content).toString("base64"),
            filename: attachment.filename,
            type: attachment.contentType,
            disposition: "attachment" as const,
          })),
        }),
    };

    try {
      return await sgMail.send(message);
    } catch (error) {
      logger.error({ error }, "Error sending email with SendGrid");
      throw error;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
