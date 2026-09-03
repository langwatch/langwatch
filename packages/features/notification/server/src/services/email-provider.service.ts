import {
  EMAIL_PROVIDER_NAMES,
  EmailProviderConfigurationError,
  type EmailProviderName,
  type MailerConfiguration,
} from "../ports/email-delivery.port";

/** What an operator must set to finish configuring a half-configured gateway. */
const MISSING_SETTING_HINT: Record<EmailProviderName, string> = {
  ses: "set USE_AWS_SES=true and AWS_REGION",
  sendgrid: "set SENDGRID_API_KEY",
  smtp: "set SMTP_URL, or SMTP_HOST with the related SMTP_* settings",
  resend: "set RESEND_API_KEY",
};

/**
 * Which outbound gateway one resolved configuration sends through.
 *
 * The sender-address derivation is static beside it, because a composition
 * root has to answer that question BEFORE it has a `MailerConfiguration` —
 * deriving `defaultFrom` from the deployment host is part of building one.
 */
export class EmailProviderService {
  static create(configuration: MailerConfiguration): EmailProviderService {
    return new EmailProviderService(configuration);
  }

  /**
   * The address mail leaves as, when the deployment did not name one.
   *
   * A frozen twin of the application's own derivation
   * (`resolveMailerDefaultFrom`, `platform/app/src/runtime/app/mailer.private-config.ts`),
   * spelling for spelling. Two processes sending the same notification from
   * two sender addresses would fail one deployment's SPF and pass the other's,
   * and the half that failed is the half nobody is watching.
   */
  static resolveDefaultFrom(input: { emailDefaultFrom?: string; baseHost: string }): string {
    if (input.emailDefaultFrom) {
      return input.emailDefaultFrom;
    }

    const hostname = EmailProviderService.hostnameOf(input.baseHost);

    if (hostname.includes("app.langwatch.ai") || hostname.includes("localhost")) {
      return "LangWatch <contact@langwatch.ai>";
    }

    return `LangWatch <mailer@${hostname}>`;
  }

  private static hostnameOf(baseHost: string): string {
    try {
      return new URL(baseHost).hostname;
    } catch {
      const withoutProtocol = baseHost.replace(/^[a-z]+:\/\//i, "");
      const hostname = withoutProtocol.split("/")[0]?.trim() ?? "";

      return hostname !== "" ? hostname : "localhost";
    }
  }

  private constructor(private readonly configuration: MailerConfiguration) {}

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
   * The gateway to send through, or null when email is not configured at all.
   *
   * `EMAIL_PROVIDER` is authoritative when set; deployments that never set it
   * are inferred from their credentials as before. A named-but-unusable
   * provider throws rather than silently falling back to another gateway,
   * because quietly sending from an unexpected sender domain is worse than a
   * loud failure. The error names a configured alternative when there is one,
   * since a chart default can supply a name the operator never chose.
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
