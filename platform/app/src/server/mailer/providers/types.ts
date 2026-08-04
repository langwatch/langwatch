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

export const EMAIL_PROVIDER_NAMES = [
  "ses",
  "sendgrid",
  "smtp",
  "resend",
] as const;

export type EmailProviderName = (typeof EMAIL_PROVIDER_NAMES)[number];

/**
 * One outbound email gateway. Implementations receive the already-normalized
 * `EmailContent` plus the resolved default `from`, and are responsible for
 * mapping the shared surface (bcc, reply-to, custom headers, attachments) onto
 * whatever their transport expects.
 */
export interface EmailProviderPort {
  name: EmailProviderName;
  send({
    content,
    defaultFrom,
  }: {
    content: EmailContent;
    defaultFrom: string;
  }): Promise<unknown>;
}

/**
 * Raised when a gateway is selected but cannot be used — an unknown name, or a
 * known one whose credentials are absent. Thrown at send time rather than at
 * import time so a misconfigured mailer never prevents the app from booting.
 */
export class EmailProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailProviderConfigurationError";
  }
}

export function toArray(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
