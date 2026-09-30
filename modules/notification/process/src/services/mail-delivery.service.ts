import type { MailDeliveryView, SendEmailCommand } from "@langwatch/notification-contract";

import {
  type EmailContent,
  type EmailDelivery,
  EmailProviderConfigurationError,
  type EmailProviderName,
  type MailGatewaySettings,
} from "../channels/email-delivery.channel.ts";
import { emailGatewayChannels } from "../channels/email-gateway-channels.registry.ts";
import { EmailProviderService } from "./email-provider.service.ts";

/**
 * How mail leaves this install: the one sender every module's mail goes through,
 * the gateway the checkup reports, and whether the SMTP relay answers.
 */
export class MailDeliveryService {
  private constructor(
    private readonly settings: () => Promise<MailGatewaySettings>,
    private readonly delivery: EmailDelivery,
  ) {}

  static create({
    settings,
    delivery,
  }: {
    settings: () => Promise<MailGatewaySettings>;
    delivery: EmailDelivery;
  }): MailDeliveryService {
    return new MailDeliveryService(settings, delivery);
  }

  async sendEmail(command: SendEmailCommand): Promise<void> {
    await this.delivery.send(envelopeOf({ command, defaultFrom: this.delivery.defaultFrom() }));
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

/** The message as a gateway sends it; the no-reply To and the one-click pair are main's bytes. */
function envelopeOf({
  command,
  defaultFrom,
}: {
  command: SendEmailCommand;
  defaultFrom: string;
}): EmailContent {
  const { undisclosedRecipients, unsubscribe, replyless, ...message } = command;
  const hidden = [
    ...(replyless === undefined ? [] : [message.to].flat()),
    ...(undisclosedRecipients ?? []),
  ];
  return {
    ...message,
    ...(replyless === undefined ? {} : { to: noReplyAddress({ tag: replyless.tag, defaultFrom }) }),
    ...(hidden.length === 0 ? {} : { bcc: hidden }),
    ...(unsubscribe === undefined
      ? {}
      : {
          headers: {
            "List-Unsubscribe": `<${unsubscribe.url}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
  };
}

/** A bare sender address has no domain to read, so `langwatch.ai` stands in, as on main. */
function noReplyAddress({ tag, defaultFrom }: { tag: string; defaultFrom: string }): string {
  const domain = defaultFrom.match(/<[^@]+@([^>]+)>/)?.[1]?.trim() || "langwatch.ai";
  return `LangWatch Triggers <no-reply+${tag}@${domain}>`;
}
