export { EmailDeliveryAdapter } from "./adapters/email-delivery.adapter.ts";
export { PostgresNotificationAdapter } from "./adapters/postgres.notification.adapter.ts";
export { notificationServer, type NotificationInfrastructure } from "./notification.server.ts";
export { ResendEmailGatewayAdapter } from "./adapters/resend.email-gateway.adapter.ts";
export { SendgridEmailGatewayAdapter } from "./adapters/sendgrid.email-gateway.adapter.ts";
export {
  SesEmailGatewayAdapter,
  type SesAwsClientConfiguration,
} from "./adapters/ses.email-gateway.adapter.ts";
export { SmtpEmailGatewayAdapter } from "./adapters/smtp.email-gateway.adapter.ts";
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
} from "./ports/email-delivery.port.ts";
export { EmailMimeService } from "./services/email-mime.service.ts";
export { EmailProviderService } from "./services/email-provider.service.ts";
export { RedisTenantBroadcastAdapter } from "./adapters/redis.tenant-broadcast.adapter.ts";
export {
  TENANT_BROADCAST_EVENT_TYPES,
  TenantBroadcastPort,
  TenantBroadcastPublisherPort,
  type TenantBroadcastEventType,
  type TenantBroadcastMessage,
} from "./ports/tenant-broadcast.port.ts";
