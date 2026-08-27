import { createHash } from "node:crypto";
import {
  ALERT_TRIGGER_DEFAULTS,
  renderTriggerEmail,
  renderTriggerSlack,
  renderWebhookBody,
  type SlackTemplateType,
} from "@langwatch/automation-contract";
import { DispatchError } from "@langwatch/eventing";
import type { AutomationClock } from "../ports/automation-clock.port";
import type { AutomationGraphDeliveryPort } from "../ports/automation-graph-delivery.port";
import type {
  GraphAlertDispatchInput,
  GraphAlertDispatchResult,
} from "../ports/automation-graph.port";
import type { AutomationNotificationDeliveryPort } from "../ports/automation-notification-delivery.port";
import type { AutomationEmailCapService } from "./email-cap.service";
import type { AutomationWebhookProviderPort } from "../ports/automation-provider.port";

function destinationHash(destination: string): string {
  return createHash("sha256").update(destination).digest("hex").slice(0, 16);
}

function emptyResult(channel: GraphAlertDispatchResult["channel"]): GraphAlertDispatchResult {
  return { channel, didSend: false, missingVariables: [], renderErrors: [] };
}

/** Graph-alert notification policy shared by real-time and heartbeat dispatch. */
export class GraphAlertDispatchService {
  private constructor(
    private readonly persistence: AutomationGraphDeliveryPort,
    private readonly emailCaps: AutomationEmailCapService,
    private readonly delivery: AutomationNotificationDeliveryPort,
    private readonly webhooks: AutomationWebhookProviderPort,
    private readonly clock: AutomationClock,
    private readonly emailHourlyCap: number,
    private readonly tenantDailyCap: number,
  ) {}

  static create(input: {
    persistence: AutomationGraphDeliveryPort;
    emailCaps: AutomationEmailCapService;
    delivery: AutomationNotificationDeliveryPort;
    webhooks: AutomationWebhookProviderPort;
    clock: AutomationClock;
    emailHourlyCap: number;
    tenantDailyCap: number;
  }): GraphAlertDispatchService {
    return new GraphAlertDispatchService(
      input.persistence,
      input.emailCaps,
      input.delivery,
      input.webhooks,
      input.clock,
      input.emailHourlyCap,
      input.tenantDailyCap,
    );
  }

  dispatch(input: GraphAlertDispatchInput): Promise<GraphAlertDispatchResult> {
    switch (input.trigger.action) {
      case "SEND_EMAIL":
        return this.sendEmail(input);
      case "SEND_SLACK_MESSAGE":
        return this.sendSlack(input);
      case "SEND_WEBHOOK":
        return this.sendWebhook(input);
      default:
        throw new DispatchError({
          message: `Graph alert action "${input.trigger.action}" is not supported`,
          retryable: false,
        });
    }
  }

  private claimKey(input: GraphAlertDispatchInput, destination: string): string {
    return `rcpt:${input.fireDigest}:${destinationHash(destination)}`;
  }

  private isSent(input: GraphAlertDispatchInput, destination: string): Promise<boolean> {
    return this.persistence.isSendClaimed({
      triggerId: input.trigger.id,
      traceId: this.claimKey(input, destination),
      projectId: input.project.id,
    });
  }

  private async recordSent(input: GraphAlertDispatchInput, destination: string): Promise<void> {
    await this.persistence.claimSend({
      triggerId: input.trigger.id,
      traceId: this.claimKey(input, destination),
      projectId: input.project.id,
    });
  }

  private async sendEmail(input: GraphAlertDispatchInput): Promise<GraphAlertDispatchResult> {
    if (input.recipients.length === 0) {
      return emptyResult("email");
    }

    const recipients = await this.persistence.filterSuppressed({
      projectId: input.project.id,
      triggerId: input.trigger.id,
      emails: input.recipients,
    });
    if (recipients.length === 0) {
      return emptyResult("email");
    }

    const now = this.clock.now();
    const hourly = await this.emailCaps.consumeHourly({
      projectId: input.project.id,
      triggerId: input.trigger.id,
      now,
      cap: this.emailHourlyCap,
      dedupKey: `${input.project.id}/${input.trigger.id}:digest:${input.fireDigest}`,
    });
    if (!hourly.allowed) {
      return { ...emptyResult("email"), didSend: true };
    }

    const daily = await this.emailCaps.consumeDaily({
      projectId: input.project.id,
      now,
      cap: this.tenantDailyCap,
      recipientCount: recipients.length,
      dedupKey: `${input.project.id}:tenant:${input.fireDigest}`,
    });
    if (!daily.allowed) {
      return { ...emptyResult("email"), didSend: true };
    }

    const rendered = await renderTriggerEmail({
      subjectTemplate: input.trigger.templates.emailSubjectTemplate,
      bodyTemplate: input.trigger.templates.emailBodyTemplate,
      context: input.context,
      defaults: ALERT_TRIGGER_DEFAULTS,
    });
    await this.delivery.sendEmail({
      recipients,
      triggerId: input.trigger.id,
      projectId: input.project.id,
      subject: rendered.subject,
      html: rendered.html,
      isRecipientSent: (recipient) => this.isSent(input, `email:${recipient}`),
      recordRecipientSent: (recipient) => this.recordSent(input, `email:${recipient}`),
    });

    return {
      channel: "email",
      didSend: true,
      missingVariables: rendered.missingVariables,
      renderErrors: rendered.errors,
    };
  }

  private async sendSlack(input: GraphAlertDispatchInput): Promise<GraphAlertDispatchResult> {
    const templateType: SlackTemplateType =
      input.trigger.templates.slackTemplateType === "block_kit" ? "block_kit" : "string";

    if (input.botDestination) {
      const destination = `slack-bot:${input.botDestination.channel}`;
      if (await this.isSent(input, destination)) {
        return { ...emptyResult("slack"), didSend: true };
      }

      const rendered = await this.renderSlack(input, templateType, true);
      await this.delivery.sendSlackBot({
        token: input.botDestination.token,
        channel: input.botDestination.channel,
        payload: rendered.payload,
        triggerName: input.trigger.name,
      });
      await this.recordSent(input, destination);

      return this.renderedResult("slack", rendered);
    }

    const webhook = input.slackWebhook?.trim();
    if (!webhook) {
      return emptyResult("slack");
    }

    const destination = `slack-webhook:${webhook}`;
    if (await this.isSent(input, destination)) {
      return { ...emptyResult("slack"), didSend: true };
    }

    const rendered = await this.renderSlack(input, templateType, false);
    await this.delivery.sendSlackWebhook({
      webhook,
      triggerName: input.trigger.name,
      payload: rendered.payload,
    });
    await this.recordSent(input, destination);

    return this.renderedResult("slack", rendered);
  }

  private renderSlack(
    input: GraphAlertDispatchInput,
    templateType: SlackTemplateType,
    allowGatedBlocks: boolean,
  ) {
    return renderTriggerSlack({
      templateType,
      template: input.trigger.templates.slackTemplate,
      context: input.context,
      defaults: ALERT_TRIGGER_DEFAULTS,
      allowGatedBlocks,
    });
  }

  private renderedResult(
    channel: "slack",
    rendered: Awaited<ReturnType<typeof renderTriggerSlack>>,
  ): GraphAlertDispatchResult {
    return {
      channel,
      didSend: true,
      missingVariables: rendered.missingVariables,
      renderErrors: rendered.errors,
    };
  }

  private async sendWebhook(input: GraphAlertDispatchInput): Promise<GraphAlertDispatchResult> {
    const params = this.webhooks.parseStored(input.trigger.actionParams);
    const destination = `webhook:${params.url}`;
    if (await this.isSent(input, destination)) {
      return { ...emptyResult("webhook"), didSend: true };
    }

    const rendered = await renderWebhookBody({
      template: params.bodyTemplate,
      context: input.context,
      defaultBody: ALERT_TRIGGER_DEFAULTS.webhookBody,
    });
    await this.delivery.sendWebhook({
      recorder: (record) => this.persistence.recordWebhookDelivery(record),
      projectId: input.project.id,
      triggerId: input.trigger.id,
      eventId: `evt_${destinationHash(`event:${input.fireDigest}`)}`,
      url: params.url,
      method: params.method,
      headers: this.webhooks.decryptHeaders(params),
      signingSecrets: this.webhooks.decryptSigningSecrets(params, this.clock.now()),
      body: rendered.body,
      triggerName: input.trigger.name,
    });
    await this.recordSent(input, destination);

    return {
      channel: "webhook",
      didSend: true,
      missingVariables: rendered.missingVariables,
      renderErrors: rendered.errors,
    };
  }
}
