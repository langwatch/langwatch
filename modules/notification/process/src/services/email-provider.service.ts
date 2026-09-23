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
  tryResolveName(): EmailProviderName | null {
    const configured = this.configuration.provider?.trim().toLowerCase();
    const available = this.configured();

    if (configured) {
      return this.selected(configured, available);
    }

    // Legacy inference, in the order the old mailer branched.
    if (available.ses) {
      return "ses";
    }

    if (available.sendgrid) {
      return "sendgrid";
    }

    return null;
  }

  private selected(
    configured: string,
    available: Record<EmailProviderName, boolean>,
  ): EmailProviderName {
    if (!EmailProviderService.isKnownProvider(configured)) {
      throw new EmailProviderConfigurationError(
        `Unknown EMAIL_PROVIDER "${configured}". Supported providers: ${EMAIL_PROVIDER_NAMES.join(", ")}.`,
      );
    }

    if (!available[configured]) {
      const hint = this.inferredHint(configured, available);

      throw new EmailProviderConfigurationError(
        `EMAIL_PROVIDER is "${configured}" but it is not configured: ${MISSING_SETTING_HINT[configured]}.${hint}`,
      );
    }

    return configured;
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

  private static isKnownProvider(value: string): value is EmailProviderName {
    return (EMAIL_PROVIDER_NAMES as readonly string[]).includes(value);
  }
}
