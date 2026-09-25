/**
 * Outbound mail seam: values and shapes only, no import-time side effects.
 * Configuration from composition root.
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

/** Which gateway is named and how each is reached: everything but the sender address. */
export type MailGatewaySettings = Omit<MailerConfiguration, "defaultFrom">;

/**
 * The proxy settings a vendor HTTPS gateway consults. Only HTTPS calls opt
 * in - an SMTP relay is usually reachable directly, so a globally-set proxy
 * would break working deployments; the SMTP gateway deliberately skips it.
 */
export type EmailOutboundProxyConfig = Readonly<{
  httpsProxy?: string;
  httpProxy?: string;
  noProxy?: string;
}>;

/**
 * One outbound email gateway. Implementations receive the normalized
 * `EmailContent` plus the resolved default `from`, mapping the shared
 * surface (bcc, reply-to, headers, attachments) onto their own transport.
 */
export abstract class EmailGateway {
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
/** Opens the gateway a provider name selects; the registry offers the production one. */
export type EmailGatewayOpener = (name: EmailProviderName) => EmailGateway;

export abstract class EmailDelivery {
  abstract defaultFrom(): string;

  abstract send(content: EmailContent): Promise<unknown>;
}

/**
 * Raised when a gateway is selected but cannot be used: an unknown name, or
 * known but missing credentials. Thrown at send time, not import time, so a
 * misconfigured mailer never prevents the process from booting.
 */
export class EmailProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailProviderConfigurationError";
  }
}

/**
 * The address a deployment's mail leaves from when the operator named none.
 * The api and the worker each derive it while parsing their own configuration,
 * and must land on the same answer or one of them fails SPF.
 */
export function resolveDefaultFrom(input: { emailDefaultFrom?: string; baseHost: string }): string {
  if (input.emailDefaultFrom) {
    return input.emailDefaultFrom;
  }

  const hostname = hostnameOf(input.baseHost);
  const sendsAsLangWatch = hostname.includes("app.langwatch.ai") || hostname.includes("localhost");

  if (sendsAsLangWatch) {
    return "LangWatch <contact@langwatch.ai>";
  }

  return `LangWatch <mailer@${hostname}>`;
}

function hostnameOf(baseHost: string): string {
  try {
    return new URL(baseHost).hostname;
  } catch {
    const withoutProtocol = baseHost.replace(/^[a-z]+:\/\//i, "");
    const hostname = withoutProtocol.split("/")[0]?.trim() ?? "";

    return hostname !== "" ? hostname : "localhost";
  }
}
