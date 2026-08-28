import type { MailerConfiguration } from "./providers/types";

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

/** Maps the validated executable configuration to the mailer’s private graph. */
export function resolveMailerConfiguration(input: {
  baseHost: string;
  emailDefaultFrom?: string;
  emailProvider?: string;
  useAwsSes?: string;
  awsRegion?: string;
  awsSesEndpoint?: string;
  sendgridApiKey?: string;
  smtpUrl?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure?: string;
  resendApiKey?: string;
}): MailerConfiguration {
  return {
    defaultFrom: resolveMailerDefaultFrom(input),
    provider: input.emailProvider,
    ses: {
      enabled: Boolean(input.useAwsSes),
      region: input.awsRegion,
      endpoint: input.awsSesEndpoint,
    },
    sendgrid: { apiKey: input.sendgridApiKey },
    smtp: {
      url: input.smtpUrl,
      host: input.smtpHost,
      port: input.smtpPort,
      user: input.smtpUser,
      password: input.smtpPassword,
      secure: input.smtpSecure,
    },
    resend: { apiKey: input.resendApiKey },
  };
}
