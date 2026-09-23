/**
 * Gateway entry: transports, provider selection, delivery adapter (no rendering).
 * Isolated to avoid pulling React/browser modules into send-only processes.
 */
export { MailerAdapter } from "./adapters/mailer.adapter.ts";
export { hasEmailProvider, resolveEmailProviderName } from "./providers/index.ts";
export {
  buildSesClientConfig,
  directSesClientConfiguration,
  SesEmailProvider,
  type SesAwsClientConfiguration,
} from "./providers/ses.ts";
export { ResendEmailProvider } from "./providers/resend.ts";
export { SendgridEmailProvider } from "./providers/sendgrid.ts";
export {
  buildSmtpTransportOptions,
  isSmtpConfigured,
  SmtpEmailProvider,
} from "./providers/smtp.ts";
export {
  EmailDelivery,
  EmailProviderConfigurationError,
  EMAIL_PROVIDER_NAMES,
  toArray,
  type EmailAttachment,
  type EmailContent,
  type EmailProvider,
  type EmailProviderName,
  type MailerConfiguration,
} from "./providers/types.ts";
export { computeDefaultFrom, sendEmail } from "./email-sender.ts";
