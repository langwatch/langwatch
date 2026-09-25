import type { MailDeliveryView } from "@langwatch/notification-contract";

import {
  EmailProviderConfigurationError,
  type EmailProviderName,
  type MailGatewaySettings,
} from "../channels/email-delivery.channel.ts";
import { emailGatewayChannels } from "../channels/email-gateway-channels.registry.ts";
import { EmailProviderService } from "./email-provider.service.ts";

/**
 * How mail leaves this install, for the checkup: the gateway named, and
 * whether the SMTP relay answers. Settings resolve on first ask, since the
 * credentials among them come through the secrets chain.
 */
export class MailDeliveryService {
  private constructor(private readonly settings: () => Promise<MailGatewaySettings>) {}

  static create({
    settings,
  }: {
    settings: () => Promise<MailGatewaySettings>;
  }): MailDeliveryService {
    return new MailDeliveryService(settings);
  }

  async getView(): Promise<MailDeliveryView> {
    const settings = await this.settings();
    const [provider] = findProviderNames(settings);
    return {
      ...(provider === undefined ? {} : { provider }),
      smtpConfigured: Boolean(settings.smtp.url ?? settings.smtp.host),
    };
  }

  async verifySmtp(): Promise<void> {
    const gateway = emailGatewayChannels.smtp.create((await this.settings()).smtp);
    try {
      await gateway.verify();
    } finally {
      await gateway.close();
    }
  }
}

/** The gateway these settings select; empty where none is, or the one named is half-configured. */
function findProviderNames(settings: MailGatewaySettings): EmailProviderName[] {
  try {
    const name = EmailProviderService.create(settings).pickProviderName();
    return name === null ? [] : [name];
  } catch (error) {
    if (error instanceof EmailProviderConfigurationError) return [];
    throw error;
  }
}
