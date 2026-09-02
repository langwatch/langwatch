export { EmailDeliveryAdapter } from "./adapters/email-delivery.adapter";
export { PostgresNotificationAdapter } from "./adapters/postgres.notification.adapter";
export { ResendEmailGatewayAdapter } from "./adapters/resend.email-gateway.adapter";
export { SendgridEmailGatewayAdapter } from "./adapters/sendgrid.email-gateway.adapter";
export {
  SesEmailGatewayAdapter,
  type SesAwsClientConfiguration,
} from "./adapters/ses.email-gateway.adapter";
export { SmtpEmailGatewayAdapter } from "./adapters/smtp.email-gateway.adapter";
export {
  EMAIL_PROVIDER_NAMES,
  EmailDeliveryPort,
  EmailGatewayPort,
  EmailProviderConfigurationError,
  type EmailAttachment,
  type EmailContent,
  type EmailOutboundProxyConfig,
  type EmailProviderName,
  type MailerConfiguration,
} from "./ports/email-delivery.port";
export { EmailMimeService } from "./services/email-mime.service";
export { EmailProviderService } from "./services/email-provider.service";
