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
    const { provider, misconfigured } = readProviderChoice(settings);
    return {
      ...(provider === null ? {} : { provider }),
      smtpConfigured: Boolean(settings.smtp.url ?? settings.smtp.host),
      misconfigured,
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

/** The gateway these settings select, and whether the one named is half-configured. */
function readProviderChoice(settings: MailGatewaySettings): {
  provider: EmailProviderName | null;
  misconfigured: boolean;
} {
  try {
    return {
      provider: EmailProviderService.create(settings).pickProviderName(),
      misconfigured: false,
    };
  } catch (error) {
    if (error instanceof EmailProviderConfigurationError) {
      return { provider: null, misconfigured: true };
    }
    throw error;
  }
}
