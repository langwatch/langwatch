/**
 * Transactional mail, through the one gateway this deployment named. Owns
 * only which gateway and address a send uses; `MAIL_PROVIDER` is the sole
 * discriminant (ADR-144 §13a) — no inference from a leftover credential.
 */
import { directSesClientConfiguration, MailerAdapter } from "@langwatch/mail/gateway";
import type { Logger } from "@langwatch/observability";

import type { MailConfig, OutboundProxyConfig } from "./config.ts";
import type { BuiltMember } from "./datastore-members.ts";
import type { Mail } from "./members.ts";

/** What `@langwatch/mail` is handed for one gateway, and nothing for the rest. */
function gatewayConfiguration(config: Exclude<MailConfig, { provider: "off" }>) {
  const blank = { ses: { enabled: false }, sendgrid: {}, smtp: {}, resend: {} } as const;
  const defaultFrom = config.defaultFrom.trim();
  if (!defaultFrom) throw new Error("Mail was configured without a sending address.");

  if (config.provider === "smtp") {
    return {
      ...blank,
      defaultFrom,
      provider: "smtp",
      smtp: {
        host: config.host,
        port: String(config.port),
        user: config.user,
        password: config.password,
        ...(config.secure === undefined ? {} : { secure: String(config.secure) }),
      },
    };
  }

  if (config.provider === "ses") {
    return {
      ...blank,
      defaultFrom,
      provider: "ses",
      ses: {
        enabled: true,
        region: config.region,
        ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
      },
    };
  }

  return { ...blank, defaultFrom, provider: "resend", resend: { apiKey: config.apiKey } };
}

export function buildMail(config: Exclude<MailConfig, { provider: "off" }>): BuiltMember<Mail> {
  const proxy: OutboundProxyConfig = config.outboundProxy ?? {};
  const adapter = MailerAdapter.create({
    configuration: gatewayConfiguration(config),
    aws: directSesClientConfiguration(),
    outboundProxy: proxy,
  });

  const mail: Mail = {
    async send(message) {
      await adapter.send({
        to: message.to,
        subject: message.subject,
        html: message.html,
        ...(message.from === undefined ? {} : { from: message.from }),
      });
    },
  };

  return { value: mail, close: () => adapter.close() };
}

/** Mail off is a state (ARCHITECTURE.md §6): each send is skipped with one line naming it. */
export function skippedMail(logger: Logger): BuiltMember<Mail> {
  const mail: Mail = {
    async send(message) {
      logger.warn(
        { subject: message.subject },
        `Email is not configured on this process (MAIL_PROVIDER=off), so "${message.subject}" was not sent`,
      );
    },
  };

  return { value: mail };
}
