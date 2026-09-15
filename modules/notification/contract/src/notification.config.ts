import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * Mail gateway config selected consistently across processes to maintain
 * SPF/sender policy alignment. All settings optional; send fails at runtime
 * if unconfigured.
 */
export const notificationServerConfigDefinition = RuntimeConfig.define({
  defaultFrom: Config.value(z.string().optional(), { env: "EMAIL_DEFAULT_FROM" }),
  provider: Config.value(z.string().optional(), { env: "EMAIL_PROVIDER" }),
  ses: {
    enabled: Config.value(z.string().optional(), { env: "USE_AWS_SES" }),
    region: Config.value(z.string().optional(), { env: "AWS_REGION" }),
    endpoint: Config.value(z.string().optional(), { env: "AWS_SES_ENDPOINT" }),
  },
  sendgrid: {
    apiKey: Config.optionalSecret({ env: "SENDGRID_API_KEY" }),
  },
  smtp: {
    url: Config.optionalSecret({ env: "SMTP_URL" }),
    host: Config.value(z.string().optional(), { env: "SMTP_HOST" }),
    port: Config.value(z.string().optional(), { env: "SMTP_PORT" }),
    user: Config.value(z.string().optional(), { env: "SMTP_USER" }),
    password: Config.optionalSecret({ env: "SMTP_PASSWORD" }),
    secure: Config.value(z.string().optional(), { env: "SMTP_SECURE" }),
  },
  resend: {
    apiKey: Config.optionalSecret({ env: "RESEND_API_KEY" }),
  },
});

export type NotificationServerConfig = ConfigValue<typeof notificationServerConfigDefinition>;

export const notificationServerConfigSchema = compileRuntimeConfig(
  notificationServerConfigDefinition,
);

/** All a browser learns: whether this deployment can send mail at all. */
export const notificationWebConfigSchema = z.strictObject({ email: z.boolean() });

export type NotificationWebConfig = z.infer<typeof notificationWebConfigSchema>;
