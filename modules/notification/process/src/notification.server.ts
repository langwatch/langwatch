import { defineServerModule } from "@langwatch/kernel";

import { NotificationApp } from "./app/notification.app.ts";
import type {
  EmailDelivery,
  EmailOutboundProxyConfig,
  MailerConfiguration,
} from "./channels/email-delivery.channel.ts";
import { emailGatewayOpener } from "./channels/email-gateway-channels.registry.ts";
import type { SesAwsClientConfiguration } from "./channels/ses/ses.email-gateway.channel.ts";
import { notificationRepositories } from "./repositories/notification-repositories.registry.ts";
import { EmailDeliveryService } from "./services/email-delivery.service.ts";

export const notificationServer = defineServerModule("notification")
  .withRepositories(notificationRepositories)
  .withApp(NotificationApp)
  .withTransports();

/**
 * What this feature contributes to a process that sends mail: the process
 * supplies the substrates it owns and receives the capability behind ports it
 * already names.
 */

/**
 * Outbound mail, and the one shutdown call the owning process must make. The
 * gateway is resolved on the first send rather than here, so a deployment that
 * configured no provider still composes.
 */
export type ClosableEmailDelivery = EmailDelivery & {
  /** Releases whatever transport the resolved gateway opened. */
  close(): Promise<void>;
};

export function createEmailDelivery(input: {
  configuration: MailerConfiguration;
  /** The AWS clients the process already owns; SES sends through them. */
  aws: SesAwsClientConfiguration;
  /** The egress this deployment requires of every outbound provider call. */
  outboundProxy: EmailOutboundProxyConfig;
}): ClosableEmailDelivery {
  return EmailDeliveryService.create({
    configuration: input.configuration,
    openGateway: emailGatewayOpener(input),
  });
}
