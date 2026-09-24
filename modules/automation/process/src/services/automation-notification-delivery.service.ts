import { createHash } from "node:crypto";

import { EMAIL_RX, type AlertType, type SlackPayload } from "@langwatch/automation-contract";
import { toDispatchError } from "@langwatch/eventing";
import type { MailRender, TriggerDigestEntry } from "@langwatch/mail";
import type { EmailDelivery } from "@langwatch/notification-process";
import { createLogger, type Logger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";
import type { TraceRecord } from "@langwatch/trace-contract";

import { AutomationNotificationDelivery } from "../channels/automation-notification-delivery.channel.ts";
import { TEST_FIRE_TRIGGER_ID_SENTINEL } from "../channels/automation-test-fire.channel.ts";
import {
  WebhookDeliveryAdapter,
  type WebhookDeliveryRequest,
  type WebhookDeliveryTransport,
  type WebhookSendResult,
} from "../channels/http/http.webhook-delivery.channel.ts";
import { SlackWebApiTransportAdapter } from "../channels/slack/slack-web-api-transport.channel.ts";
import {
  SlackWebApiDeliveryAdapter,
  type SlackApiTransport,
} from "../channels/slack/slack.web-api-delivery.channel.ts";
import { SlackWebhookClientAdapter } from "../channels/slack/slack.webhook-client.channel.ts";
import { SlackWebhookDeliveryAdapter } from "../channels/slack/slack.webhook-delivery.channel.ts";
import { TriggerNoReplyService, TriggerNoReplyWarning } from "./trigger-no-reply.service.ts";
import { UnsubscribeTokenService } from "./unsubscribe-token.service.ts";

/** One settled match, as the digest renders it. */
type SettlementDigestEntry = {
  traceId: string;
  input: string;
  output: string;
  projectId: string;
  fullTrace: TraceRecord;
};

/** How much of a trace's input the digest shows before it stops being a preview. */
const DIGEST_PREVIEW_MAX_CHARS = 140;

/**
 * A settled match for the digest template, using pre-hydrated trace timestamps
 * and computed inputs.
 */
function toDigestEntry(entry: SettlementDigestEntry): TriggerDigestEntry {
  const preview = entry.input.trim();
  const startedAt = entry.fullTrace.timestamps?.started_at;

  return {
    traceId: entry.traceId,
    ...(typeof startedAt === "number"
      ? {
          occurredAt: Temporal.Instant.fromEpochMilliseconds(startedAt).toString({
            fractionalSecondDigits: 3,
          }),
          occurredAtMs: startedAt,
        }
      : {}),
    ...(preview ? { preview: preview.slice(0, DIGEST_PREVIEW_MAX_CHARS) } : {}),
  };
}

/**
 * Owns the transports, secrets, and mail-envelope conventions for automation
 * alerts. The webhook transport is SSRF-fenced and injected (not every process
 * has one).
 */
export class AutomationNotificationDeliveryAdapter extends AutomationNotificationDelivery {
  static create(options: {
    mailer: EmailDelivery;
    /**
     * Renders the default digest. `@langwatch/mail` holds the words; this
     * adapter holds the envelope they leave in.
     */
    renderer: MailRender;
    /** The deployment's own origin; every unsubscribe link is built from it. */
    baseHost: string;
    /** `NEXTAUTH_SECRET`, as the application spells it. */
    unsubscribeSigningSecret?: string;
    /** Supplied once an SSRF-fenced outbound sender is composable here. */
    webhookTransport?: WebhookDeliveryTransport;
    slackWebhookClient?: SlackWebhookClientAdapter;
    slackApiTransport?: SlackApiTransport;
    logger?: Logger;
  }): AutomationNotificationDeliveryAdapter {
    const logger = options.logger ?? createLogger("langwatch:automations:delivery");
    const slackClient = options.slackWebhookClient ?? SlackWebhookClientAdapter.create();

    return new AutomationNotificationDeliveryAdapter({
      mailer: options.mailer,
      renderer: options.renderer,
      baseHost: options.baseHost,
      unsubscribeTokens: UnsubscribeTokenService.create({
        secret: options.unsubscribeSigningSecret,
      }),
      noReply: TriggerNoReplyService.create({
        secret: options.unsubscribeSigningSecret,
        warnings: new LoggedNoReplyWarning(logger),
      }),
      slackWebhooks: SlackWebhookDeliveryAdapter.create((webhook) => ({
        send: (payload) => slackClient.send({ webhook, payload }),
      })),
      slackApi: SlackWebApiDeliveryAdapter.create(
        options.slackApiTransport ?? SlackWebApiTransportAdapter.create(),
      ),
      webhooks: options.webhookTransport
        ? WebhookDeliveryAdapter.create(options.webhookTransport)
        : undefined,
      logger,
    });
  }

  private readonly mailer: EmailDelivery;

  private readonly renderer: MailRender;

  private readonly baseHost: string;

  private readonly unsubscribeTokens: UnsubscribeTokenService;

  private readonly noReply: TriggerNoReplyService;

  private readonly slackWebhooks: SlackWebhookDeliveryAdapter;

  private readonly slackApi: SlackWebApiDeliveryAdapter;

  private readonly webhooks: WebhookDeliveryAdapter | undefined;

  private readonly logger: Logger;

  private constructor({
    mailer,
    renderer,
    baseHost,
    unsubscribeTokens,
    noReply,
    slackWebhooks,
    slackApi,
    webhooks,
    logger,
  }: {
    mailer: EmailDelivery;
    renderer: MailRender;
    baseHost: string;
    unsubscribeTokens: UnsubscribeTokenService;
    noReply: TriggerNoReplyService;
    slackWebhooks: SlackWebhookDeliveryAdapter;
    slackApi: SlackWebApiDeliveryAdapter;
    webhooks: WebhookDeliveryAdapter | undefined;
    logger: Logger;
  }) {
    super();

    this.mailer = mailer;

    this.renderer = renderer;

    this.baseHost = baseHost;

    this.unsubscribeTokens = unsubscribeTokens;

    this.noReply = noReply;

    this.slackWebhooks = slackWebhooks;

    this.slackApi = slackApi;

    this.webhooks = webhooks;

    this.logger = logger;
  }

  /**
   * The default digest using the deployment's own template. Render failures are
   * non-retryable (they fail deterministically).
   */
  async sendLegacyEmail(input: {
    recipients: string[];
    triggerData: SettlementDigestEntry[];
    triggerName: string;
    triggerId: string;
    projectId: string;
    projectSlug: string;
    triggerType: AlertType | null;
    triggerMessage: string;
    isRecipientSent: (recipientHash: string) => Promise<boolean>;
    recordRecipientSent: (recipientHash: string) => Promise<void>;
  }): Promise<void> {
    let html: string;
    try {
      html = await this.renderer.renderTriggerDigest({
        triggerName: input.triggerName,
        triggerType: input.triggerType,
        triggerMessage: input.triggerMessage,
        projectSlug: input.projectSlug,
        baseHost: this.baseHost,
        entries: input.triggerData.map(toDigestEntry),
      });
    } catch (error) {
      throw toDispatchError(error, {
        message: `Trigger email render failed for trigger "${input.triggerName}"`,
        retryable: false,
      });
    }

    try {
      await this.sendPerRecipient({
        recipients: input.recipients,
        triggerId: input.triggerId,
        projectId: input.projectId,
        subject: `${input.triggerType ? `(${input.triggerType}) ` : ""}Trigger - ${input.triggerName}`,
        html,
        isRecipientSent: input.isRecipientSent,
        recordRecipientSent: input.recordRecipientSent,
      });
    } catch (error) {
      throw toDispatchError(error, {
        message: `Trigger email dispatch failed for trigger "${input.triggerName}"`,
      });
    }
  }

  /**
   * The same digest, as a Slack message. Rendered by the packaged adapter
   * rather than here: escaping customer text into Slack mrkdwn is a
   * correctness question (an unescaped `<` forges a link), kept in ONE place.
   */
  sendLegacySlackWebhook(input: {
    webhook: string;
    triggerData: SettlementDigestEntry[];
    triggerName: string;
    projectSlug: string;
    triggerType: AlertType | null;
    triggerMessage: string;
    baseHost: string;
  }): Promise<void> {
    return this.slackWebhooks.deliver({
      triggerWebhook: input.webhook,
      triggerData: input.triggerData,
      triggerName: input.triggerName,
      projectSlug: input.projectSlug,
      triggerType: input.triggerType,
      triggerMessage: input.triggerMessage,
      baseHost: input.baseHost,
    });
  }

  /**
   * One envelope per recipient (ADR-031). Safe under queue redelivery via
   * idempotency key at recipient granularity.
   */
  async sendEmail(input: {
    recipients: string[];
    triggerId: string;
    projectId: string;
    subject: string;
    html: string;
    isRecipientSent(recipientHash: string): Promise<boolean>;
    recordRecipientSent(recipientHash: string): Promise<void>;
  }): Promise<void> {
    try {
      await this.sendPerRecipient(input);
    } catch (error) {
      throw toDispatchError(error, {
        message: `Trigger email dispatch failed for trigger "${input.triggerId}"`,
      });
    }
  }

  sendSlackWebhook(input: {
    webhook: string;
    triggerName: string;
    payload: SlackPayload;
  }): Promise<void> {
    return this.slackWebhooks.deliverRendered({
      triggerWebhook: input.webhook,
      triggerName: input.triggerName,
      payload: input.payload,
    });
  }

  sendSlackBot(input: {
    token: string;
    channel: string;
    payload: SlackPayload;
    triggerName: string;
  }): Promise<void> {
    return this.slackApi.post(input);
  }

  sendWebhook(input: WebhookDeliveryRequest): Promise<WebhookSendResult> {
    if (!this.webhooks) {
      return Promise.reject(
        new Error(
          "This process composes no outbound webhook sender, so webhook automations cannot be delivered from it. Supply a webhook transport to the delivery adapter.",
        ),
      );
    }

    return this.webhooks.deliver(input);
  }

  private async sendPerRecipient(input: {
    recipients: string[];
    triggerId: string;
    projectId: string;
    subject: string;
    html: string;
    isRecipientSent(recipientHash: string): Promise<boolean>;
    recordRecipientSent(recipientHash: string): Promise<void>;
  }): Promise<void> {
    // Defence in depth at the boundary: every template context builder strips
    // CR/LF from what it interpolates, but a subject is assembled from
    // free-form values in several places, and a newline in one becomes an
    // injected SMTP header no matter which builder produced it.
    const subject = input.subject.replace(/[\r\n\0]+/g, " ");
    const to = this.noReply.addressFor({
      defaultFrom: this.mailer.defaultFrom(),
      triggerId: input.triggerId,
    });
    const isSentinel = input.triggerId === TEST_FIRE_TRIGGER_ID_SENTINEL;

    for (const recipient of input.recipients) {
      // `actionParams` is free-form JSON, so a recipient may never have been
      // validated against the schema. A malformed address is skipped before it
      // reaches a provider's `bcc` slot, which also blocks CRLF smuggling.
      if (!EMAIL_RX.test(recipient)) {
        this.logger.warn(
          { triggerId: input.triggerId, projectId: input.projectId },
          "Skipping malformed trigger email recipient",
        );
        continue;
      }

      // The address is hashed before it is used as a claim key: the claim is
      // written to a shared table and read back in logs, and the recipient
      // list is the customer's own business.
      const recipientHash = createHash("sha256").update(recipient).digest("hex").slice(0, 16);
      if (await input.isRecipientSent(recipientHash)) continue;

      if (isSentinel) {
        // A test to the author's own inbox needs no suppression context, and
        // the token requires a real automation id. Sentinel sends also stay
        // out of the dedup ledger entirely.
        await this.mailer.send({ to, bcc: [recipient], subject, html: input.html });
        continue;
      }

      const unsubscribe = this.unsubscribeFooter({
        projectId: input.projectId,
        triggerId: input.triggerId,
        email: recipient,
      });
      await this.mailer.send({
        to,
        bcc: [recipient],
        subject,
        html: injectFooterIntoBody(input.html, unsubscribe.footerHtml),
        headers: unsubscribe.headers,
      });

      // Recorded only AFTER the provider accepted it, so a retryable failure
      // does not permanently suppress this recipient's retry.
      await input.recordRecipientSent(recipientHash);
    }
  }

  /**
   * The footer appended OUTSIDE the customer's template (ADR-031), plus the
   * RFC 8058 headers beside it. Two scopes: this automation, or the whole
   * project — both links are per-recipient, HMAC-bound to one address.
   */
  private unsubscribeFooter(payload: { projectId: string; triggerId: string; email: string }): {
    footerHtml: string;
    headers: Record<string, string>;
  } {
    const triggerToken = this.unsubscribeTokens.sign(payload);
    const projectToken = this.unsubscribeTokens.sign({ ...payload, triggerId: null });
    const page = (token: string) =>
      `${this.baseHost}/unsubscribe?token=${encodeURIComponent(token)}`;

    return {
      footerHtml: `
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #F2F4F8;color:#8B96A5;font-size:12px;line-height:18px;">
      <a href="${page(triggerToken)}" style="color:#8B96A5;text-decoration:underline;">Stop receiving this notification</a>
      &nbsp;·&nbsp;
      <a href="${page(projectToken)}" style="color:#8B96A5;text-decoration:underline;">Stop all notifications from this project</a>
    </div>`,
      headers: {
        // RFC 8058: the one-click POST goes to the API route, never the page a
        // person reads.
        "List-Unsubscribe": `<${this.baseHost}/api/unsubscribe?token=${encodeURIComponent(triggerToken)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };
  }
}

/**
 * `render()` returns a whole HTML document, so appending the footer would
 * land it after `</body></html>` and some clients drop content there. Insert
 * before the closing tag when present, else append (fragments, plain HTML).
 */
export function injectFooterIntoBody(html: string, footerHtml: string): string {
  const bodyClose = /<\/body>/i;

  return bodyClose.test(html)
    ? html.replace(bodyClose, `${footerHtml}</body>`)
    : `${html}${footerHtml}`;
}

class LoggedNoReplyWarning extends TriggerNoReplyWarning {
  constructor(private readonly logger: Logger) {
    super();
  }

  unguessabilityUnavailable(message: string): void {
    this.logger.warn(message);
  }
}
