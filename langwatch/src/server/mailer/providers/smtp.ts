import { createLogger } from "@langwatch/observability";
import nodemailer from "nodemailer";
import { env } from "../../../env.mjs";
import { sanitizeHeaderValue } from "./mime";
import {
  type EmailContent,
  EmailProviderConfigurationError,
  type EmailProviderPort,
  toArray,
} from "./types";

const logger = createLogger("langwatch:mailer:smtp");

export const isSmtpConfigured = (): boolean =>
  Boolean(env.SMTP_URL ?? env.SMTP_HOST);

/**
 * Transport options from either a single connection URL or the discrete
 * host/port/credential settings. A URL wins when both are present.
 *
 * No proxy is applied here on purpose. An SMTP relay is typically an internal
 * host reachable directly, so honouring a globally-set HTTPS_PROXY would break
 * deployments that set it for vendor API egress only.
 */
export const buildSmtpTransportOptions = () => {
  if (env.SMTP_URL) return env.SMTP_URL;

  const host = env.SMTP_HOST;
  if (!host) {
    throw new EmailProviderConfigurationError(
      "EMAIL_PROVIDER is 'smtp' but neither SMTP_URL nor SMTP_HOST is set.",
    );
  }

  const port = env.SMTP_PORT ? Number(env.SMTP_PORT) : 587;
  if (Number.isNaN(port)) {
    throw new EmailProviderConfigurationError(
      `SMTP_PORT must be a number, got "${env.SMTP_PORT}".`,
    );
  }

  // Implicit TLS is the norm on 465; everything else starts plaintext and
  // upgrades via STARTTLS, which nodemailer does automatically when offered.
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465;

  const user = env.SMTP_USER;
  const pass = env.SMTP_PASSWORD;

  return {
    host,
    port,
    secure,
    // Unauthenticated relays are common inside private networks.
    ...(user ? { auth: { user, pass } } : {}),
  };
};

export const smtpProvider: EmailProviderPort = {
  name: "smtp",
  async send(content: EmailContent, defaultFrom: string) {
    logger.info("Sending email using SMTP");
    const transporter = nodemailer.createTransport(
      buildSmtpTransportOptions() as never,
    );

    const bccAddresses = toArray(content.bcc);

    const sanitizedHeaders =
      content.headers && Object.keys(content.headers).length > 0
        ? Object.fromEntries(
            Object.entries(content.headers).map(([name, value]) => [
              sanitizeHeaderValue(name),
              sanitizeHeaderValue(value),
            ]),
          )
        : undefined;

    const from = content.from ?? defaultFrom;
    const toAddresses = toArray(content.to);

    try {
      // Passing `bcc` to nodemailer renders a real `Bcc:` header, which would
      // expose every blind recipient to everyone on the message. Instead the
      // blind addresses go only into the SMTP envelope, so delivery reaches
      // them while the rendered headers show just the public To list — the
      // same guarantee SES `SendRawEmail` and SendGrid give.
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
            attachments: content.attachments.map((att) => ({
              filename: att.filename,
              content: att.content,
              contentType: att.contentType,
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
    } finally {
      transporter.close();
    }
  },
};
