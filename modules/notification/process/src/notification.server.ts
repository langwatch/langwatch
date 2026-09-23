import { defineServerModule } from "@langwatch/kernel";
import type { Logger } from "@langwatch/observability";

import { NotificationApp } from "./app/notification.app.ts";
import type {
  EmailDelivery,
  EmailOutboundProxyConfig,
  MailerConfiguration,
} from "./channels/email-delivery.channel.ts";
import type { TenantBroadcast } from "./channels/tenant-broadcast.channel.ts";
import { TenantBroadcastPublisher } from "./channels/tenant-broadcast.channel.ts";
import { notificationRepositories } from "./repositories/notification-repositories.registry.ts";
import { RedisTenantBroadcastRepository } from "./repositories/redis/redis.tenant-broadcast.repository.ts";
import { EmailDeliveryAdapter } from "./services/email-delivery.service.ts";
import type { SesAwsClientConfiguration } from "./services/ses.email-gateway.service.ts";

export const notificationServer = defineServerModule("notification")
  .withRepositories(notificationRepositories)
  .withApp(NotificationApp)
  .build();

/**
 * What this feature contributes to a process that sends mail or tells a
 * tenant's open tabs something changed: the process supplies the substrates it
 * owns and receives the capability behind ports it already names.
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
  return EmailDeliveryAdapter.create(input);
}

/**
 * The publisher a background process tells a tenant's open tabs through, over
 * the one Redis operation a broadcast performs.
 */
export function createRedisTenantBroadcast(input: {
  /** The process's own Redis publish, bound to its connection. */
  publish(channel: string, message: string): Promise<number>;
  logger?: Logger;
}): TenantBroadcast {
  return RedisTenantBroadcastRepository.create({
    publisher: new BoundTenantBroadcastPublisher(input.publish.bind(input)),
    ...(input.logger ? { logger: input.logger } : {}),
  });
}

class BoundTenantBroadcastPublisher extends TenantBroadcastPublisher {
  constructor(private readonly send: (channel: string, message: string) => Promise<number>) {
    super();
  }

  publish(channel: string, message: string): Promise<number> {
    return this.send(channel, message);
  }
}
