import { pickMailGateway } from "@langwatch/notification-contract";

import {
  EMAIL_PROVIDER_NAMES,
  EmailProviderConfigurationError,
  resolveDefaultFrom,
  type EmailProviderName,
  type MailGatewaySettings,
} from "../channels/email-delivery.channel.ts";

/** What an operator must set to finish configuring a half-configured gateway. */
const MISSING_SETTING_HINT: Record<EmailProviderName, string> = {
  ses: "set USE_AWS_SES=true and AWS_REGION",
  sendgrid: "set SENDGRID_API_KEY",
  smtp: "set SMTP_URL, or SMTP_HOST with the related SMTP_* settings",
  resend: "set RESEND_API_KEY",
};

/**
 * Selects outbound gateway; sender-address derivation is static and resolved
 * before MailerConfiguration.
 */
export class EmailProviderService {
  static create(configuration: MailGatewaySettings): EmailProviderService {
    return new EmailProviderService(configuration);
  }

  /**
   * Default sender address. The derivation lives in
   * `channels/email-delivery.channel.ts`; this static stands only until the
   * two config parsers call it there directly.
   */
  static resolveDefaultFrom(input: { emailDefaultFrom?: string; baseHost: string }): string {
    return resolveDefaultFrom(input);
  }

  private constructor(private readonly configuration: MailGatewaySettings) {}

  /** Whether each gateway has the settings it needs to attempt a send. */
  private configured(): Record<EmailProviderName, boolean> {
    const { ses, sendgrid, smtp, resend } = this.configuration;

    return {
      ses: ses.enabled && Boolean(ses.region),
      sendgrid: Boolean(sendgrid.apiKey),
      smtp: Boolean(smtp.url ?? smtp.host),
      resend: Boolean(resend.apiKey),
    };
  }

  /**
   * Gateway selection: EMAIL_PROVIDER authoritative; fails loudly on
   * misconfiguration.
   */
  pickProviderName(): EmailProviderName | null {
    const available = this.configured();
    const pick = pickMailGateway({ provider: this.configuration.provider, available });

    if ("gateway" in pick) return pick.gateway;

    if (pick.refused === "unknown") {
      throw new EmailProviderConfigurationError(
        `Unknown EMAIL_PROVIDER "${pick.named}". Supported providers: ${EMAIL_PROVIDER_NAMES.join(", ")}.`,
      );
    }

    throw new EmailProviderConfigurationError(
      `EMAIL_PROVIDER is "${pick.wanted}" but it is not configured: ${MISSING_SETTING_HINT[pick.wanted]}.${this.inferredHint(pick.wanted, available)}`,
    );
  }

  private inferredHint(
    configured: EmailProviderName,
    available: Record<EmailProviderName, boolean>,
  ): string {
    const alternative = EMAIL_PROVIDER_NAMES.find((name) => name !== configured && available[name]);

    return alternative
      ? ` Settings for "${alternative}" are present, did you mean EMAIL_PROVIDER=${alternative}?`
      : "";
  }
}
