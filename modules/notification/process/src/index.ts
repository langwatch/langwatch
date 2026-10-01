export { notificationProcessModule } from "./notification.module.ts";

/**
 * What a process composes this feature through: outbound mail, and the sender
 * address a configuration parser derives before it exists.
 */
export { createEmailDelivery, type ClosableEmailDelivery } from "./notification.module.ts";

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
export type { SesAwsClientConfiguration } from "./channels/ses/ses.email-gateway.channel.ts";
