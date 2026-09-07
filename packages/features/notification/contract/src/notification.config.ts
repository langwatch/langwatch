import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * The one outbound mail gateway every process that sends mail selects
 * through.
 *
 * A password-reset link leaving one process from a different sender domain
 * than a reminder leaving another would fail one deployment's SPF policy and
 * pass the other's, and the half that failed is the half nobody is watching —
 * so every leaf here is read identically wherever mail is sent.
 *
 * `ses.enabled` is presence-based rather than boolean on purpose: existing
 * deployments treat `USE_AWS_SES=false` as enabled, and changing that would
 * select a different gateway in one process and not another.
 *
 * Every gateway setting stays optional. A deployment with no email provider
 * configured is an ordinary self-hosted install: it composes, mounts every
 * pipeline, and fails only at the moment of a send.
 *
 * The base host a sender address and every mailed link derive from is NOT
 * here. Both processes already bind `BASE_HOST` for a purpose of their own,
 * and one variable may be bound once.
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
