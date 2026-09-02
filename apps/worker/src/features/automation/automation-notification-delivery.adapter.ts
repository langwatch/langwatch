import { createHash } from "node:crypto";
import { EMAIL_RX, type AlertType, type SlackPayload } from "@langwatch/automation-contract";
import {
  AutomationNotificationDeliveryPort,
  SlackWebApiDeliveryAdapter,
  SlackWebhookDeliveryAdapter,
  TEST_FIRE_TRIGGER_ID_SENTINEL,
  TriggerNoReplyService,
  TriggerNoReplyWarningPort,
  UnsubscribeTokenService,
  WebhookDeliveryAdapter,
  type SlackApiTransport,
  type WebhookDeliveryRequest,
  type WebhookDeliveryTransport,
  type WebhookSendResult,
} from "@langwatch/automation-server";
import { toDispatchError } from "@langwatch/eventing";
import type { TraceRecord } from "@langwatch/trace-contract";
import type { EmailDeliveryPort } from "@langwatch/notification-server";
import { createLogger, type Logger } from "@langwatch/observability";
import { renderTriggerDigestEmail } from "./trigger-digest-mail.template";
import { WorkerSlackWebhookClientAdapter } from "./slack-webhook.client.adapter";
import { WorkerSlackWebApiTransportAdapter } from "./slack-web-api.transport.adapter";

/** One settled match, as the digest renders it. */
type SettlementDigestEntry = {
  traceId: string;
  input: string;
  output: string;
  projectId: string;
  fullTrace: TraceRecord;
};

/**
 * Everything an automation alert can leave this process through.
 *
 * Automation decides WHEN an alert is sent, to whom, and what it says; this
 * adapter owns the transports, the secrets they carry, and the mail-envelope
 * conventions that are a deployment's rather than a feature's — the no-reply
 * `To`, the BCC fan-out, the unsubscribe footer and its one-click headers.
 *
 * ## The two legacy methods
 *
 * `sendLegacyEmail` and `sendLegacySlackWebhook` are the trace-settlement
 * digest's, and the graph path reaches neither — `GraphAlertDispatchService`
 * calls `sendEmail`, `sendSlackWebhook`, `sendSlackBot` and `sendWebhook`, and
 * nothing else. They are NOT a legacy corner of settlement, though: they are
 * its DEFAULT. An automation only takes the rendered path once its author has
 * written a custom subject or body, so an unedited automation — which is most
 * of them — sends through these two.
 *
 * ## The webhook transport
 *
 * A webhook destination is a URL the CUSTOMER typed, which is the one outbound
 * address in this file that can be pointed at a private network. The
 * application fences it behind an SSRF-validating sender with its own URL
 * admission policy, its own dispatch budget and its own signing; none of that
 * is packaged yet, and re-implementing an egress fence per process is how two
 * fences end up disagreeing. So the transport is INJECTED: a process that has
 * one supplies it, and a process that does not refuses webhook alerts by name.
 */
export class WorkerAutomationNotificationDeliveryAdapter extends AutomationNotificationDeliveryPort {
  static create(options: {
    mailer: EmailDeliveryPort;
    /** The deployment's own origin; every unsubscribe link is built from it. */
    baseHost: string;
    /** `NEXTAUTH_SECRET`, as the application spells it. */
    unsubscribeSigningSecret?: string;
    /** Supplied once an SSRF-fenced outbound sender is composable here. */
    webhookTransport?: WebhookDeliveryTransport;
    slackWebhookClient?: WorkerSlackWebhookClientAdapter;
    slackApiTransport?: SlackApiTransport;
    logger?: Logger;
  }): WorkerAutomationNotificationDeliveryAdapter {
    const logger = options.logger ?? createLogger("langwatch:automations:delivery");
    const slackClient = options.slackWebhookClient ?? WorkerSlackWebhookClientAdapter.create();

    return new WorkerAutomationNotificationDeliveryAdapter(
      options.mailer,
      options.baseHost,
      UnsubscribeTokenService.create({ secret: options.unsubscribeSigningSecret }),
      TriggerNoReplyService.create({
        secret: options.unsubscribeSigningSecret,
        warnings: new LoggedNoReplyWarning(logger),
      }),
      SlackWebhookDeliveryAdapter.create((webhook) => ({
        send: (payload) => slackClient.send({ webhook, payload }),
      })),
      SlackWebApiDeliveryAdapter.create(
        options.slackApiTransport ?? WorkerSlackWebApiTransportAdapter.create(),
      ),
      options.webhookTransport
        ? WebhookDeliveryAdapter.create(options.webhookTransport)
        : undefined,
      logger,
    );
  }

  private constructor(
    private readonly mailer: EmailDeliveryPort,
    private readonly baseHost: string,
    private readonly unsubscribeTokens: UnsubscribeTokenService,
    private readonly noReply: TriggerNoReplyService,
    private readonly slackWebhooks: SlackWebhookDeliveryAdapter,
    private readonly slackApi: SlackWebApiDeliveryAdapter,
    private readonly webhooks: WebhookDeliveryAdapter | undefined,
    private readonly logger: Logger,
  ) {
    super();
  }

  /**
   * The default digest: the deployment's own template rather than the
   * customer's.
   *
   * The render happens INSIDE the `DispatchError` wrap and is classified
   * non-retryable, because a tree that fails to render fails identically on
   * every attempt — the outbox has to promote the row to dead rather than loop
   * on a payload that can never succeed. The send that follows keeps the
   * default classification, since a provider failure usually is transient.
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
    isRecipientSent(recipientHash: string): Promise<boolean>;
    recordRecipientSent(recipientHash: string): Promise<void>;
  }): Promise<void> {
    let html: string;
    try {
      html = await renderTriggerDigestEmail({
        triggerName: input.triggerName,
        triggerType: input.triggerType,
        triggerMessage: input.triggerMessage,
        projectSlug: input.projectSlug,
        baseHost: this.baseHost,
        entries: input.triggerData,
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
   * The same digest, as a Slack message.
   *
   * Rendered by the packaged adapter rather than here: escaping customer text
   * into Slack mrkdwn is a correctness question — an unescaped `<` forges a
   * link — and one implementation of it is what keeps two processes from
   * disagreeing about which characters are safe.
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
   * One envelope per recipient (ADR-031).
   *
   * Each recipient gets the no-reply `To` so addresses cannot be enumerated
   * from a header, the rendered body with a footer bound to that recipient,
   * and one-click `List-Unsubscribe` headers. The idempotency pair makes the
   * fan-out safe under queue redelivery at RECIPIENT granularity: a retry
   * after a partial send resumes rather than starting over.
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
   * The footer appended OUTSIDE the customer's template (ADR-031), so a
   * template author cannot strip it, and the RFC 8058 headers beside it.
   *
   * Two scopes are offered: this automation only, and every automation in the
   * project. Both links are per-recipient, which is what makes them
   * forge-proof — the token's HMAC binds the link to one address.
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
 * `render()` returns a whole HTML document, so appending the footer would land
 * it after `</body></html>`, and some mail clients drop content outside the
 * body. Insert it immediately before the closing tag when there is one, and
 * append otherwise (fragments, plain HTML).
 */
export function injectFooterIntoBody(html: string, footerHtml: string): string {
  const bodyClose = /<\/body>/i;

  return bodyClose.test(html)
    ? html.replace(bodyClose, `${footerHtml}</body>`)
    : `${html}${footerHtml}`;
}

class LoggedNoReplyWarning extends TriggerNoReplyWarningPort {
  constructor(private readonly logger: Logger) {
    super();
  }

  unguessabilityUnavailable(message: string): void {
    this.logger.warn(message);
  }
}
