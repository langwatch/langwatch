export { notificationServer } from "./notification.server.ts";

/**
 * What a process composes this feature through: outbound mail, the tenant
 * broadcast, and the sender address a configuration parser derives before
 * either exists.
 */
export {
  createEmailDelivery,
  createRedisTenantBroadcast,
  type ClosableEmailDelivery,
} from "./notification.server.ts";

/** The outbound-mail vocabulary and the two ports it is carried over. */
export {
  EMAIL_PROVIDER_NAMES,
  EmailDelivery,
  EmailGateway,
  EmailProviderConfigurationError,
  resolveDefaultFrom,
  type EmailAttachment,
  type EmailContent,
  type EmailOutboundProxyConfig,
  type EmailProviderName,
  type MailerConfiguration,
} from "./channels/email-delivery.channel.ts";
export type { SesAwsClientConfiguration } from "./services/ses.email-gateway.service.ts";

/** What a tenant's open tabs are told, and the one Redis call that tells them. */
export {
  TENANT_BROADCAST_EVENT_TYPES,
  TenantBroadcast,
  TenantBroadcastPublisher,
  type TenantBroadcastEventType,
  type TenantBroadcastMessage,
} from "./channels/tenant-broadcast.channel.ts";

/*
 * Private runtime surface, kept until importers call the factories above
 * (`private-runtime-export` baseline, expires 2026-10-01). The one non-obvious
 * mapping: EmailProviderService below is what `resolveDefaultFrom` wraps.
 */
export { EmailDeliveryAdapter } from "./services/email-delivery.service.ts";
export { RedisTenantBroadcastChannel as RedisTenantBroadcastAdapter } from "./channels/redis/redis.tenant-broadcast.channel.ts";
export { EmailProviderService } from "./services/email-provider.service.ts";
