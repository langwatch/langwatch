import { createLogger } from "@langwatch/observability";
import { EnvHttpProxyAgent } from "undici";
import { env } from "../../../env.mjs";
import { sanitizeHeaderValue } from "./mime";
import { hostnameOf, resolveProxyForHost } from "./proxy";
import {
  type EmailContent,
  EmailProviderConfigurationError,
  type EmailProviderPort,
  toArray,
} from "./types";

const logger = createLogger("langwatch:mailer:resend");

const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * undici honours HTTP_PROXY/HTTPS_PROXY/NO_PROXY itself once given this
 * dispatcher, so we only need to decide whether a proxy applies at all.
 */
const proxyDispatcher = (): EnvHttpProxyAgent | undefined =>
  resolveProxyForHost(hostnameOf(RESEND_API_URL))
    ? new EnvHttpProxyAgent()
    : undefined;

export const resendProvider: EmailProviderPort = {
  name: "resend",
  async send(content: EmailContent, defaultFrom: string) {
    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) {
      throw new EmailProviderConfigurationError(
        "EMAIL_PROVIDER is 'resend' but RESEND_API_KEY is not set.",
      );
    }

    logger.info("Sending email using Resend");
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

    // Resend delivers `bcc` via the envelope, so blind recipients stay hidden
    // from the rendered headers, matching the other gateways.
    const payload = {
      from: content.from ?? defaultFrom,
      to: toArray(content.to),
      subject: content.subject,
      html: content.html,
      ...(bccAddresses.length > 0 && { bcc: bccAddresses }),
      ...(content.replyTo && { reply_to: content.replyTo }),
      ...(sanitizedHeaders && { headers: sanitizedHeaders }),
      ...(content.attachments &&
        content.attachments.length > 0 && {
          attachments: content.attachments.map((att) => ({
            filename: att.filename,
            content: Buffer.from(att.content).toString("base64"),
            content_type: att.contentType,
          })),
        }),
    };

    const dispatcher = proxyDispatcher();

    try {
      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit);

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Resend responded ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`,
        );
      }

      const data = (await response.json()) as { id?: string };
      logger.info(
        {
          messageId: data.id,
          recipientCount: toArray(content.to).length + bccAddresses.length,
        },
        "Email sent successfully",
      );
      return data;
    } catch (error) {
      logger.error({ error }, "Error sending email with Resend");
      throw error;
    }
  },
};
