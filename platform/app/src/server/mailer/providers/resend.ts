import { createLogger } from "@langwatch/observability";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import { hostnameOf, resolveProxyForHost, type OutboundProxyConfig } from "../../outboundProxy";
import { sanitizeHeaders } from "./mime";
import {
  type EmailContent,
  EmailProviderConfigurationError,
  type EmailProviderPort,
  type MailerConfiguration,
  toArray,
} from "./types";

const logger = createLogger("langwatch:mailer:resend");

const RESEND_API_URL = "https://api.resend.com/emails";

/** Matches the SMTP gateway: a queued notification must not hang on a dead API. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The dispatcher is process-owned: building one per send would accumulate
 * pools and file descriptors under a burst of alerts.
 */
const proxyDispatcher = (proxyConfig: OutboundProxyConfig): EnvHttpProxyAgent | undefined => {
  if (!resolveProxyForHost(proxyConfig, hostnameOf(RESEND_API_URL))) return undefined;
  return new EnvHttpProxyAgent({
    httpProxy: proxyConfig.httpProxy ?? "",
    httpsProxy: proxyConfig.httpsProxy ?? "",
    noProxy: proxyConfig.noProxy ?? "",
  });
};

const encodeAttachments = (attachments: EmailContent["attachments"]) => {
  if (!attachments || attachments.length === 0) return undefined;
  return attachments.map((att) => ({
    filename: att.filename,
    content: Buffer.from(att.content).toString("base64"),
    content_type: att.contentType,
  }));
};

/**
 * Resend delivers `bcc` via the envelope, so blind recipients stay hidden from
 * the rendered headers, matching the other gateways.
 */
const buildPayload = (content: EmailContent, defaultFrom: string) => {
  const bccAddresses = toArray(content.bcc);
  const headers = sanitizeHeaders(content.headers);
  const attachments = encodeAttachments(content.attachments);

  return {
    from: content.from ?? defaultFrom,
    to: toArray(content.to),
    subject: content.subject,
    html: content.html,
    ...(bccAddresses.length > 0 && { bcc: bccAddresses }),
    ...(content.replyTo && { reply_to: content.replyTo }),
    ...(headers && { headers }),
    ...(attachments && { attachments }),
  };
};

export class ResendEmailProvider implements EmailProviderPort {
  readonly name = "resend" as const;

  static create(input: {
    configuration: MailerConfiguration["resend"];
    outboundProxy: OutboundProxyConfig;
  }): ResendEmailProvider {
    return new ResendEmailProvider(input.configuration, input.outboundProxy);
  }

  private dispatcher: EnvHttpProxyAgent | undefined;

  private closed = false;

  private constructor(
    private readonly configuration: MailerConfiguration["resend"],
    private readonly outboundProxy: OutboundProxyConfig,
  ) {}

  async send({ content, defaultFrom }: { content: EmailContent; defaultFrom: string }) {
    if (this.closed) throw new Error("Resend email provider is closed.");
    const apiKey = this.configuration.apiKey;
    if (!apiKey) {
      throw new EmailProviderConfigurationError(
        "EMAIL_PROVIDER is 'resend' but RESEND_API_KEY is not set.",
      );
    }

    logger.info("Sending email using Resend");
    const bccAddresses = toArray(content.bcc);
    const payload = buildPayload(content, defaultFrom);
    this.dispatcher ??= proxyDispatcher(this.outboundProxy);
    const dispatcher = this.dispatcher;

    try {
      // undici's own fetch, not the global one: Node's global fetch is bound to
      // the undici bundled with Node, which rejects a dispatcher built by this
      // package with "invalid onRequestStart method". Using both from the same
      // package is what makes the proxy actually apply.
      const response = await undiciFetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(dispatcher ? { dispatcher } : {}),
      });

      if (!response.ok) {
        // The body is deliberately not read: Resend echoes the request on
        // failure, so it can carry recipient addresses, and this error is
        // logged. The status identifies the failure class. It still has to be
        // cancelled, or undici keeps the connection out of the pool.
        await response.body?.cancel().catch(() => void 0);
        throw new Error(`Resend responded ${response.status} ${response.statusText}`);
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
  }

  async close(): Promise<void> {
    this.closed = true;
    const dispatcher = this.dispatcher;
    this.dispatcher = undefined;
    await dispatcher?.close();
  }
}
