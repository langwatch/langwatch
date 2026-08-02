import { env } from "../../../env.mjs";
import { resendProvider } from "./resend";
import { sendgridProvider } from "./sendgrid";
import { sesProvider } from "./ses";
import { isSmtpConfigured, smtpProvider } from "./smtp";
import {
  EMAIL_PROVIDER_NAMES,
  EmailProviderConfigurationError,
  type EmailProviderName,
  type EmailProviderPort,
} from "./types";

const providers: Record<EmailProviderName, EmailProviderPort> = {
  ses: sesProvider,
  sendgrid: sendgridProvider,
  smtp: smtpProvider,
  resend: resendProvider,
};

/** Whether each gateway has the settings it needs to attempt a send. */
const isConfigured: Record<EmailProviderName, () => boolean> = {
  ses: () => Boolean(env.USE_AWS_SES && env.AWS_REGION),
  sendgrid: () => Boolean(env.SENDGRID_API_KEY),
  smtp: isSmtpConfigured,
  resend: () => Boolean(env.RESEND_API_KEY),
};

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
 * The gateway to send through, or null when email is not configured at all.
 *
 * `EMAIL_PROVIDER` is authoritative when set. Deployments that predate it are
 * still inferred from their credentials, so upgrading changes nothing for
 * them. A named-but-unusable provider throws rather than silently falling back
 * to another gateway, because quietly sending from an unexpected sender domain
 * is worse than a loud failure.
 */
export const resolveEmailProvider = (): EmailProviderPort | null => {
  const configured = env.EMAIL_PROVIDER?.trim().toLowerCase();

  if (configured) {
    if (!isKnownProvider(configured)) {
      throw new EmailProviderConfigurationError(
        `Unknown EMAIL_PROVIDER "${configured}". Supported providers: ${EMAIL_PROVIDER_NAMES.join(", ")}.`,
      );
    }
    if (!isConfigured[configured]()) {
      throw new EmailProviderConfigurationError(
        `EMAIL_PROVIDER is "${configured}" but it is not configured — ${missingSettingHint[configured]}.`,
      );
    }
    return providers[configured];
  }

  // Legacy inference, in the order the old mailer branched.
  if (isConfigured.ses()) return providers.ses;
  if (isConfigured.sendgrid()) return providers.sendgrid;

  return null;
};

/** Whether any gateway is usable. Never throws — used to gate UI affordances. */
export const hasEmailProvider = (): boolean => {
  try {
    return resolveEmailProvider() !== null;
  } catch {
    return false;
  }
};

export type { EmailProviderName, EmailProviderPort };
export { EmailProviderConfigurationError };
