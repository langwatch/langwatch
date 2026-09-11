/**
 * The gateway half of this package: the four transports, the provider
 * selection and the delivery adapter, and nothing that renders.
 *
 * It exists as its own entry because the root entry pulls the templates, and
 * the templates pull react-email and so React. A process that only SENDS - the
 * infrastructure pool's mail member is exactly that - must not carry 2,000
 * browser modules on its boot graph to do it. Rendering stays at the root
 * entry, where the studio and the template tests read it.
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
export { buildSmtpTransportOptions, isSmtpConfigured, SmtpEmailProvider } from "./providers/smtp.ts";
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
