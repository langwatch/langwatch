import { createLogger } from "@langwatch/observability";
import {
  EMAIL_PROVIDER_NAMES,
  EmailProviderConfigurationError,
  type MailerConfiguration,
  type EmailProviderName,
} from "./types";

const logger = createLogger("langwatch:mailer:providers");

/** Whether each gateway has the settings it needs to attempt a send. */
const isConfigured = (configuration: MailerConfiguration): Record<EmailProviderName, boolean> => ({
  ses: configuration.ses.enabled && Boolean(configuration.ses.region),
  sendgrid: Boolean(configuration.sendgrid.apiKey),
  smtp: Boolean(configuration.smtp.url ?? configuration.smtp.host),
  resend: Boolean(configuration.resend.apiKey),
});

/** What an operator must set to finish configuring a half-configured gateway. */
const missingSettingHint: Record<EmailProviderName, string> = {
  ses: "set USE_AWS_SES=true and AWS_REGION",
  sendgrid: "set SENDGRID_API_KEY",
  smtp: "set SMTP_URL, or SMTP_HOST with the related SMTP_* settings",
  resend: "set RESEND_API_KEY",
};

const isKnownProvider = (value: string): value is EmailProviderName =>
  (EMAIL_PROVIDER_NAMES as readonly string[]).includes(value);

/**
 * When the named gateway is unusable but another one is fully configured, the
 * likely cause is a name that disagrees with the settings actually supplied,
 * which reads as a missing credential and is really a wrong gateway. Naming
 * the alternative lets that shape diagnose itself.
 */
const inferredProviderHint = ({
  configured,
  configuration,
}: {
  configured: EmailProviderName;
  configuration: MailerConfiguration;
}): string => {
  const available = isConfigured(configuration);
  const alternative = EMAIL_PROVIDER_NAMES.find((name) => name !== configured && available[name]);
  return alternative
    ? ` Settings for "${alternative}" are present, did you mean EMAIL_PROVIDER=${alternative}?`
    : "";
};

/**
 * The gateway to send through, or null when email is not configured at all.
 *
 * `EMAIL_PROVIDER` is authoritative when set; deployments that never set it are
 * inferred from their credentials as before. A named-but-unusable provider
 * throws rather than silently falling back to another gateway, because quietly
 * sending from an unexpected sender domain is worse than a loud failure. The
 * error names a configured alternative when there is one, since a chart default
 * can supply a name the operator never chose.
 */
export const resolveEmailProviderName = (
  configuration: MailerConfiguration,
): EmailProviderName | null => {
  const configured = configuration.provider?.trim().toLowerCase();
  const available = isConfigured(configuration);

  if (configured) {
    if (!isKnownProvider(configured)) {
      throw new EmailProviderConfigurationError(
        `Unknown EMAIL_PROVIDER "${configured}". Supported providers: ${EMAIL_PROVIDER_NAMES.join(", ")}.`,
      );
    }
    if (!available[configured]) {
      throw new EmailProviderConfigurationError(
        `EMAIL_PROVIDER is "${configured}" but it is not configured: ${missingSettingHint[configured]}.${inferredProviderHint({ configured, configuration })}`,
      );
    }
    return configured;
  }

  // Legacy inference, in the order the old mailer branched.
  if (available.ses) return "ses";
  if (available.sendgrid) return "sendgrid";

  return null;
};

/** Whether any gateway is usable. Never throws, so it can gate UI affordances. */
export const hasEmailProvider = (configuration: MailerConfiguration): boolean => {
  try {
    return resolveEmailProviderName(configuration) !== null;
  } catch (error) {
    // Without this the email UI just silently disappears, giving the operator
    // no signal that their EMAIL_PROVIDER is set but unusable.
    logger.warn({ error }, "Email provider is configured but unusable");
    return false;
  }
};

export type { EmailProviderName };
export { EmailProviderConfigurationError };
