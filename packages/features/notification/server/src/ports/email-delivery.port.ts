/**
 * The outbound mail seam, as a background process can hold it.
 *
 * Everything here is a value or a shape: no environment is read, no client is
 * constructed at import time, and no gateway is chosen. A composition root
 * resolves one `MailerConfiguration` at boot and hands it down, which is what
 * keeps credentials stable for the lifetime of a process and lets a test
 * compose a delivery graph without an environment at all.
 */

export type EmailAttachment = {
  filename: string;
  content: string;
  contentType: string;
};

export type EmailContent = {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  /** When present, these addresses are delivered as BCC, so they don't appear
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

export const EMAIL_PROVIDER_NAMES = ["ses", "sendgrid", "smtp", "resend"] as const;

export type EmailProviderName = (typeof EMAIL_PROVIDER_NAMES)[number];

/**
 * Private process configuration for the one selected outbound mail gateway.
 * It is resolved at executable boot and never read from the environment by a
 * gateway, which keeps credentials stable for the lifetime of the process.
 */
export type MailerConfiguration = Readonly<{
  defaultFrom: string;
  provider?: string;
  ses: Readonly<{
    enabled: boolean;
    region?: string;
    endpoint?: string;
  }>;
  sendgrid: Readonly<{ apiKey?: string }>;
  smtp: Readonly<{
    url?: string;
    host?: string;
    port?: string;
    user?: string;
    password?: string;
    secure?: string;
  }>;
  resend: Readonly<{ apiKey?: string }>;
}>;

/**
 * The proxy settings a vendor HTTPS gateway consults.
 *
 * Only vendor HTTPS calls opt in. An SMTP relay is usually an internal host
 * that is reachable directly, so applying a globally-set proxy to it would
 * break working deployments; the SMTP gateway deliberately does not.
 */
export type EmailOutboundProxyConfig = Readonly<{
  httpsProxy?: string;
  httpProxy?: string;
  noProxy?: string;
}>;

/**
 * One outbound email gateway. Implementations receive the already-normalized
 * `EmailContent` plus the resolved default `from`, and are responsible for
 * mapping the shared surface (bcc, reply-to, custom headers, attachments) onto
 * whatever their transport expects.
 */
export abstract class EmailGatewayPort {
  /** One address or many, as every transport below wants to see them. */
  static recipients(value: string | string[] | undefined): string[] {
    if (value == null) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  }

  abstract readonly name: EmailProviderName;

  abstract send(input: { content: EmailContent; defaultFrom: string }): Promise<unknown>;

  abstract close(): Promise<void>;
}

/** A composed mail delivery capability, injected into application adapters. */
export abstract class EmailDeliveryPort {
  abstract defaultFrom(): string;

  abstract send(content: EmailContent): Promise<unknown>;
}

/**
 * Raised when a gateway is selected but cannot be used: an unknown name, or a
 * known one whose credentials are absent. Thrown at send time rather than at
 * import time so a misconfigured mailer never prevents the process from
 * booting.
 */
export class EmailProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailProviderConfigurationError";
  }
}
