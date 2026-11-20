import type { TransactionalEmailOutcome } from "@langwatch/enterprise-nurturing-contract";
import type { MailDeliveryView, SendEmailCommand } from "@langwatch/notification-contract";
import { createLogger } from "@langwatch/observability";

import type { CustomerIoMailChannel } from "../channels/customer-io-mail.channel.ts";
import {
  type EmailContent,
  type EmailDelivery,
  EmailProviderConfigurationError,
  type EmailProviderName,
  type MailGatewaySettings,
} from "../channels/email-delivery.channel.ts";
import { emailGatewayChannels } from "../channels/email-gateway-channels.registry.ts";
import { findCustomerIoRequests } from "../rules/customer-io-routing.rules.ts";
import { oneClickUnsubscribeHeaders } from "../rules/email-mime.rules.ts";
import { EmailProviderService } from "./email-provider.service.ts";

const logger = createLogger("langwatch:mailer:customer-io");

/**
 * How mail leaves this install: the one sender every module's mail goes through,
 * the gateway the checkup reports, and whether the SMTP relay answers. On LangWatch
 * Cloud some templates go through Customer.io first (rules/customer-io-routing.rules.ts).
 */
export class MailDeliveryService {
  private constructor(
    private readonly settings: () => Promise<MailGatewaySettings>,
    private readonly delivery: EmailDelivery,
    private readonly customerIo: CustomerIoMailChannel | undefined,
  ) {}

  static create({
    settings,
    delivery,
    customerIo,
  }: {
    settings: () => Promise<MailGatewaySettings>;
    delivery: EmailDelivery;
    /** Present only on LangWatch Cloud; absent, every send takes the own mailer, unchanged. */
    customerIo?: CustomerIoMailChannel;
  }): MailDeliveryService {
    return new MailDeliveryService(settings, delivery, customerIo);
  }

  /**
   * Routing reads the command before `envelopeOf` does: the envelope swaps a replyless `to`
   * for the no-reply address, and Customer.io must be handed the real recipient.
   */
  async sendEmail(command: SendEmailCommand): Promise<void> {
    const defaultFrom = this.delivery.defaultFrom();
    const { replyless } = command;
    const replyTo = replyless && noReplyAddress({ tag: replyless.tag, defaultFrom });
    const customerIo = this.customerIo;
    const requests = customerIo ? findCustomerIoRequests({ command, defaultFrom, replyTo }) : [];
    if (!customerIo || requests.length === 0) {
      await this.delivery.send(envelopeOf({ command, defaultFrom }));
      return;
    }

    // Every recipient gets its attempt before a failure is raised, so one bad fallback does not
    // cost the others their message.
    const failures: unknown[] = [];
    for (const [index, request] of requests.entries()) {
      const answer = await outcomeOf(() => customerIo.send(request));
      // `off` is nurturing without the App API key, which holds for every recipient alike. Asked
      // first, it means nothing went out yet: the message leaves as it would with no Customer.io,
      // one envelope under the caller's own key.
      if (answer.outcome === "off" && index === 0) {
        await this.delivery.send(envelopeOf({ command, defaultFrom }));
        return;
      }
      try {
        await this.settle({
          answer,
          template: request.transactionalMessageId,
          command: commandForOne({ command, recipient: request.to, of: requests.length }),
          defaultFrom,
        });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw failures[0];
  }

  /** One recipient's answer from Customer.io; whatever it did not accept, the own mailer sends. */
  private async settle({
    answer,
    template,
    command,
    defaultFrom,
  }: {
    answer: CustomerIoAnswer;
    template: string;
    command: SendEmailCommand;
    defaultFrom: string;
  }): Promise<void> {
    if (answer.outcome === "queued") {
      logger.info({ template, deliveryId: answer.deliveryId }, "Email handed to Customer.io");
      return;
    }
    if (answer.outcome === "refused") {
      logger.warn(
        { template, reason: answer.reason, status: answer.status },
        "Customer.io did not take an email, so the own mailer sends it",
      );
    }
    // Customer.io's send API takes no idempotency key, so the caller's never reaches it: a timeout
    // or an unreadable reply on a send Customer.io did in fact queue makes this a second copy, as
    // does a caller's retry of a send it queued. We prefer a duplicate to a lost email: these are
    // messages a person acts on (a request waiting on them, a limit reached).
    await this.delivery.send(envelopeOf({ command, defaultFrom }));
  }

  async getView(): Promise<MailDeliveryView> {
    const settings = await this.settings();
    const { provider, misconfigured } = readProviderChoice(settings);
    return {
      ...(provider === null ? {} : { provider }),
      smtpConfigured: Boolean(settings.smtp.url ?? settings.smtp.host),
      smtpSendsCredentials: sendsSmtpCredentials({ smtp: settings.smtp }),
      misconfigured,
    };
  }

  async verifySmtp(): Promise<void> {
    const gateway = emailGatewayChannels.smtp.create((await this.settings()).smtp);
    try {
      await gateway.verify();
    } finally {
      await gateway.close();
    }
  }
}

/** The gateway these settings select, and whether the one named is half-configured. */
function readProviderChoice(settings: MailGatewaySettings): {
  provider: EmailProviderName | null;
  misconfigured: boolean;
} {
  try {
    return {
      provider: EmailProviderService.create(settings).pickProviderName(),
      misconfigured: false,
    };
  } catch (error) {
    if (error instanceof EmailProviderConfigurationError) {
      return { provider: null, misconfigured: true };
    }
    throw error;
  }
}

/** The message as a gateway sends it; the no-reply To and the one-click pair are main's bytes. */
function envelopeOf({
  command,
  defaultFrom,
}: {
  command: SendEmailCommand;
  defaultFrom: string;
}): EmailContent {
  // The template id only picks a provider; no gateway sends it.
  const {
    undisclosedRecipients,
    unsubscribe,
    replyless,
    template: _template,
    ...message
  } = command;
  const hidden = [
    ...(replyless === undefined ? [] : [message.to].flat()),
    ...(undisclosedRecipients ?? []),
  ];
  return {
    ...message,
    ...(replyless === undefined ? {} : { to: noReplyAddress({ tag: replyless.tag, defaultFrom }) }),
    ...(hidden.length === 0 ? {} : { bcc: hidden }),
    ...(unsubscribe === undefined ? {} : { headers: oneClickUnsubscribeHeaders(unsubscribe.url) }),
  };
}

/**
 * The send the own mailer makes for one recipient Customer.io did not take: that recipient
 * alone, as the visible one. A key shared by several recipients gets the recipient appended, or
 * a gateway that deduplicates by key would take the second fallback for a retry of the first.
 */
function commandForOne({
  command,
  recipient,
  of,
}: {
  command: SendEmailCommand;
  recipient: string;
  of: number;
}): SendEmailCommand {
  return {
    ...command,
    to: recipient,
    undisclosedRecipients: undefined,
    ...(of > 1 && command.idempotencyKey !== undefined
      ? { idempotencyKey: `${command.idempotencyKey}:${recipient}` }
      : {}),
  };
}

/** Nurturing's answer, or an `unexpected` refusal when the call itself threw. */
type CustomerIoAnswer =
  | TransactionalEmailOutcome
  | Readonly<{ outcome: "refused"; reason: "unexpected"; status?: undefined }>;

/**
 * Nurturing answers a refusal rather than throwing one; anything that still throws is a refusal
 * too, so the recipient gets the own mailer. The error is not logged: it may hold the address.
 */
async function outcomeOf(
  send: () => Promise<TransactionalEmailOutcome>,
): Promise<CustomerIoAnswer> {
  try {
    return await send();
  } catch {
    return { outcome: "refused", reason: "unexpected" };
  }
}

/** A bare sender address has no domain to read, so `langwatch.ai` stands in, as on main. */
function noReplyAddress({ tag, defaultFrom }: { tag: string; defaultFrom: string }): string {
  const domain = defaultFrom.match(/<[^@]+@([^>]+)>/)?.[1]?.trim() || "langwatch.ai";
  return `LangWatch Triggers <no-reply+${tag}@${domain}>`;
}

/** Whether the transport logs in: a user in the URL, else `SMTP_USER` (a URL wins). */
function sendsSmtpCredentials({ smtp }: { smtp: MailGatewaySettings["smtp"] }): boolean {
  if (!smtp.url) return Boolean(smtp.user);
  try {
    return new URL(smtp.url).username !== "";
  } catch {
    return false;
  }
}
