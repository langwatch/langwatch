import { createLogger } from "@langwatch/observability";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import {
  type EmailContent,
  EmailGatewayPort,
  EmailProviderConfigurationError,
  type MailerConfiguration,
} from "../ports/email-delivery.port";
import { EmailMimeService } from "../services/email-mime.service";

const logger = createLogger("langwatch:mailer:smtp");

/**
 * Nodemailer's own defaults let a send hang for minutes (2m to connect, 10m of
 * socket inactivity). An unreachable relay is a common misconfiguration, so
 * fail fast enough that a queued notification does not sit on a dead socket.
 */
const SMTP_TIMEOUTS = {
  connectionTimeout: 15_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
} as const;

/** A process-owned SMTP connection pool, reused across notification deliveries. */
export class SmtpEmailGatewayAdapter extends EmailGatewayPort {
  static create(configuration: MailerConfiguration["smtp"]): SmtpEmailGatewayAdapter {
    return new SmtpEmailGatewayAdapter(configuration);
  }

  /**
   * Transport options from either a single connection URL or the discrete
   * host/port/credential settings. A URL wins when both are present.
   *
   * No proxy is applied here on purpose. An SMTP relay is typically an
   * internal host reachable directly, so honouring a globally-set HTTPS_PROXY
   * would break deployments that set it for vendor API egress only.
   */
  static buildTransportOptions(configuration: MailerConfiguration["smtp"]): SMTPTransport.Options {
    if (configuration.url) {
      return { url: configuration.url, ...SMTP_TIMEOUTS };
    }

    const host = configuration.host;

    if (!host) {
      throw new EmailProviderConfigurationError(
        "EMAIL_PROVIDER is 'smtp' but neither SMTP_URL nor SMTP_HOST is set.",
      );
    }

    const port = configuration.port ? Number(configuration.port) : 587;

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new EmailProviderConfigurationError(
        `SMTP_PORT must be an integer between 1 and 65535, got "${configuration.port}".`,
      );
    }

    // Implicit TLS is the norm on 465; everything else starts plaintext and
    // upgrades via STARTTLS, which nodemailer does automatically when offered.
    const secure = configuration.secure ? configuration.secure === "true" : port === 465;
    const user = configuration.user;
    const pass = configuration.password;

    return {
      host,
      port,
      secure,
      // Unauthenticated relays are common inside private networks.
      ...(user ? { auth: { user, pass } } : {}),
      ...SMTP_TIMEOUTS,
    };
  }

  readonly name = "smtp" as const;

  private readonly mime = EmailMimeService.create();

  private transporter: ReturnType<typeof nodemailer.createTransport> | undefined;

  private closed = false;

  private constructor(private readonly configuration: MailerConfiguration["smtp"]) {
    super();
  }

  async send({ content, defaultFrom }: { content: EmailContent; defaultFrom: string }) {
    if (this.closed) throw new Error("SMTP email provider is closed.");
    logger.info("Sending email using SMTP");
    const transporter = (this.transporter ??= nodemailer.createTransport(
      SmtpEmailGatewayAdapter.buildTransportOptions(this.configuration),
    ));

    const bccAddresses = EmailGatewayPort.recipients(content.bcc);
    const sanitizedHeaders = this.mime.trySanitizeHeaders(content.headers);
    const from = content.from ?? defaultFrom;
    const toAddresses = EmailGatewayPort.recipients(content.to);

    try {
      // Blind addresses go only into the SMTP envelope. nodemailer would also
      // keep them off the wire if passed as a `bcc` field (mail-composer drops
      // the header unless keepBcc is set), but that is a library default rather
      // than a property of this code. Stating the envelope explicitly makes the
      // guarantee ours: the rendered headers carry only the public To list,
      // matching SES `SendRawEmail` and SendGrid.
      const info = await transporter.sendMail({
        from,
        to: toAddresses,
        subject: content.subject,
        html: content.html,
        ...(bccAddresses.length > 0 && {
          envelope: { from, to: [...toAddresses, ...bccAddresses] },
        }),
        ...(content.replyTo && { replyTo: content.replyTo }),
        ...(sanitizedHeaders && { headers: sanitizedHeaders }),
        ...(content.attachments &&
          content.attachments.length > 0 && {
            attachments: content.attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content,
              contentType: attachment.contentType,
            })),
          }),
      });
      logger.info(
        {
          messageId: info.messageId,
          recipientCount: toAddresses.length + bccAddresses.length,
        },
        "Email sent successfully",
      );
      return info;
    } catch (error) {
      logger.error({ error }, "Error sending email with SMTP");
      throw error;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.transporter?.close();
    this.transporter = undefined;
  }
}
