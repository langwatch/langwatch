import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * Mail gateway config; all settings optional, send fails at runtime if
 * unconfigured. Credentials never live here (ADR-132) — they are handles on
 * the App that resolves them.
 */
export const notificationConfig = Config.define((c) => ({
  defaultFrom: c.env("EMAIL_DEFAULT_FROM", z.string().optional()),
  provider: c.env("EMAIL_PROVIDER", z.string().optional()),
  ses: {
    enabled: c.env("USE_AWS_SES", z.string().optional()),
    region: c.env("AWS_REGION", z.string().optional()),
    endpoint: c.env("AWS_SES_ENDPOINT", z.string().optional()),
  },
  smtp: {
    host: c.env("SMTP_HOST", z.string().optional()),
    port: c.env("SMTP_PORT", z.string().optional()),
    user: c.env("SMTP_USER", z.string().optional()),
    secure: c.env("SMTP_SECURE", z.string().optional()),
  },
}));

export type NotificationServerConfig = ConfigOf<typeof notificationConfig>;

/** All a browser learns: whether this deployment can send mail at all. */
export const notificationWebConfigSchema = z.strictObject({ email: z.boolean() });

export type NotificationWebConfig = z.infer<typeof notificationWebConfigSchema>;
