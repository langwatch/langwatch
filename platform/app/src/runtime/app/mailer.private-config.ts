import { Config, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";
import type { MailerConfiguration } from "~/server/mailer/providers/types";

const mailerPrivateConfigDefinition = RuntimeConfig.define({
  baseHost: Config.value(z.string().min(1), { env: "BASE_HOST" }),
  // Keep the legacy empty-string value: unsubscribe signing rejects it at the
  // security boundary, while trigger no-reply hashing deliberately degrades.
  nextauthSecret: Config.value(z.string().optional(), { env: "NEXTAUTH_SECRET" }),
  emailDefaultFrom: Config.value(z.string().optional(), { env: "EMAIL_DEFAULT_FROM" }),
  provider: Config.value(z.string().optional(), { env: "EMAIL_PROVIDER" }),
  ses: {
    // This deliberately remains presence-based: existing deployments treat
    // USE_AWS_SES=false as enabled, and changing that would select a different
    // provider at send time.
    enabled: Config.value(z.string().optional(), { env: "USE_AWS_SES" }),
    region: Config.value(z.string().optional(), { env: "AWS_REGION" }),
    endpoint: Config.value(z.string().optional(), { env: "AWS_SES_ENDPOINT" }),
  },
  sendgrid: {
    apiKey: Config.value(z.string().optional(), { env: "SENDGRID_API_KEY" }),
  },
  smtp: {
    url: Config.value(z.string().optional(), { env: "SMTP_URL" }),
    host: Config.value(z.string().optional(), { env: "SMTP_HOST" }),
    port: Config.value(z.string().optional(), { env: "SMTP_PORT" }),
    user: Config.value(z.string().optional(), { env: "SMTP_USER" }),
    password: Config.value(z.string().optional(), { env: "SMTP_PASSWORD" }),
    secure: Config.value(z.string().optional(), { env: "SMTP_SECURE" }),
  },
  resend: {
    apiKey: Config.value(z.string().optional(), { env: "RESEND_API_KEY" }),
  },
});

type MailerPrivateConfig = ConfigValue<typeof mailerPrivateConfigDefinition>;

export type AppMailRuntimeConfiguration = Readonly<{
  baseHost: string;
  nextauthSecret: string | undefined;
}>;

const extractHostname = (baseHost: string): string => {
  try {
    const url = new URL(baseHost);
    return url.hostname;
  } catch {
    const withoutProtocol = baseHost.replace(/^[a-z]+:\/\//i, "");
    const hostname = withoutProtocol.split("/")[0]?.trim() ?? "";
    return hostname !== "" ? hostname : "localhost";
  }
};

export function resolveMailerDefaultFrom(input: {
  emailDefaultFrom?: string;
  baseHost: string;
}): string {
  if (input.emailDefaultFrom) return input.emailDefaultFrom;

  const hostname = extractHostname(input.baseHost);
  if (hostname.includes("app.langwatch.ai") || hostname.includes("localhost")) {
    return "LangWatch <contact@langwatch.ai>";
  }
  return `LangWatch <mailer@${hostname}>`;
}

/**
 * Projects the private mail gateway configuration once at application
 * composition. Provider adapters receive this semantic value and never read
 * the application environment themselves.
 */
export function resolveAppMailerConfiguration(
  source: Readonly<Record<string, unknown>>,
): MailerConfiguration {
  return resolveAppMailConfiguration(source).mailer;
}

export function resolveAppMailConfiguration(source: Readonly<Record<string, unknown>>): {
  mailer: MailerConfiguration;
  runtime: AppMailRuntimeConfiguration;
} {
  const configuration = RuntimeConfig.create({
    name: "application mailer",
    definition: mailerPrivateConfigDefinition,
    source,
  }).value;

  return {
    mailer: toMailerConfiguration(configuration),
    runtime: {
      baseHost: configuration.baseHost,
      nextauthSecret: configuration.nextauthSecret,
    },
  };
}

function toMailerConfiguration(configuration: MailerPrivateConfig): MailerConfiguration {
  return {
    defaultFrom: resolveMailerDefaultFrom(configuration),
    provider: configuration.provider,
    ses: {
      enabled: Boolean(configuration.ses.enabled),
      region: configuration.ses.region,
      endpoint: configuration.ses.endpoint,
    },
    sendgrid: { apiKey: configuration.sendgrid.apiKey },
    smtp: {
      url: configuration.smtp.url,
      host: configuration.smtp.host,
      port: configuration.smtp.port,
      user: configuration.smtp.user,
      password: configuration.smtp.password,
      secure: configuration.smtp.secure,
    },
    resend: { apiKey: configuration.resend.apiKey },
  };
}
