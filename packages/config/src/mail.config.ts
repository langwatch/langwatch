import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config";

/**
 * The one outbound mail gateway every process that sends mail selects through,
 * at the deployment's own spelling.
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
 * The gateway settings stay optional. A deployment with no email provider
 * configured is an ordinary self-hosted install: it composes, mounts every
 * pipeline, and fails only at the moment of a send.
 *
 * The base host a sender address and every mailed link are derived from is
 * NOT here — each process binds `BASE_HOST` at its own leaf, because some
 * already bind it for an unrelated purpose and this module refuses to bind
 * one variable twice.
 */
export const mailConfigDefinition = RuntimeConfig.define({
  defaultFrom: Config.value(z.string().optional(), { env: "EMAIL_DEFAULT_FROM" }),
  provider: Config.value(z.string().optional(), { env: "EMAIL_PROVIDER" }),
  ses: {
    enabled: Config.value(z.string().optional(), { env: "USE_AWS_SES" }),
    region: Config.value(z.string().optional(), { env: "AWS_REGION" }),
    endpoint: Config.value(z.string().optional(), { env: "AWS_SES_ENDPOINT" }),
  },
  sendgrid: {
    apiKey: Config.secret({ optional: true, env: "SENDGRID_API_KEY" }),
  },
  smtp: {
    url: Config.secret({ optional: true, env: "SMTP_URL" }),
    host: Config.value(z.string().optional(), { env: "SMTP_HOST" }),
    port: Config.value(z.string().optional(), { env: "SMTP_PORT" }),
    user: Config.value(z.string().optional(), { env: "SMTP_USER" }),
    password: Config.secret({ optional: true, env: "SMTP_PASSWORD" }),
    secure: Config.value(z.string().optional(), { env: "SMTP_SECURE" }),
  },
  resend: {
    apiKey: Config.secret({ optional: true, env: "RESEND_API_KEY" }),
  },
});
