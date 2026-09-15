/**
 * Transactional mail, through the one gateway this deployment named.
 *
 * The four transports, their credentials and their retries belong to
 * `@langwatch/mail`; what belongs here is the one decision the process makes
 * about them - which gateway, and from which address - and the one shape a
 * module writes, so a module sends without naming a provider or an address.
 *
 * `MAIL_PROVIDER` is the discriminant (ADR-144, ruling 13a), so each gateway's
 * own leaves are required for that gateway alone and unreadable for the
 * others. There is no inference from whichever credential happens to be
 * present: a deployment that carries a leftover key for a gateway it no longer
 * uses would otherwise send from an unexpected sender domain.
 */
import { directSesClientConfiguration, MailerAdapter } from "@langwatch/mail/gateway";
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
