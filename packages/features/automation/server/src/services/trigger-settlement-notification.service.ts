import { createHash } from "node:crypto";
import {
  buildTemplateContext,
  renderTriggerSlack,
  renderWebhookBody,
  slackActionParamsSchema,
  slackDeliveryMethodOf,
  type TemplateMatchInput,
  type TemplateContext,
  type TriggerSummary,
} from "@langwatch/automation-contract";
import type { AutomationService } from "@langwatch/automation-contract";
import { DispatchError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { ProjectService } from "@langwatch/project-contract";
import { TraceNotFoundError, type TraceRecord, type TraceService } from "@langwatch/trace-contract";
import type { AutomationClockPort } from "../ports/automation-clock.port";
import type { AutomationNotificationDeliveryPort } from "../ports/automation-notification-delivery.port";
import type {
  AutomationSlackProviderPort,
  AutomationWebhookProviderPort,
} from "../ports/automation-provider.port";
import type {
  AutomationSettlementMatchConfirmationPort,
  AutomationSettlementObservabilityPort,
} from "../ports/automation-settlement.port";
import type { AutomationEmailCapService } from "./email-cap.service";
import {
  TriggerSettlementEmailService,
  type SettlementNotificationCandidate,
} from "./trigger-settlement-email.service";

const logger = createLogger("langwatch:automation:settlement-notification");

type NotificationComposition = {
  automation: AutomationService;
  projects: ProjectService;
  traces: TraceService;
  confirmation: AutomationSettlementMatchConfirmationPort;
  delivery: AutomationNotificationDeliveryPort;
  emailCaps: AutomationEmailCapService;
  slack: AutomationSlackProviderPort;
  webhooks: AutomationWebhookProviderPort;
  clock: AutomationClockPort;
  observability: AutomationSettlementObservabilityPort;
  baseHost: string;
  emailHourlyCap: number;
  tenantDailyCap: number;
};

type ConfirmedNotificationCandidate = {
  traceId: string;
  input: string;
  output: string;
  fullTrace: TraceRecord;
};

function actionParamsError(trigger: TriggerSummary): DispatchError {
  return new DispatchError({
    message: `Automation trigger "${trigger.name}" has invalid ${trigger.action} action parameters`,
    retryable: false,
  });
}

function fallbackTrace(input: {
  projectId: string;
  traceId: string;
  occurredAt: number;
}): TraceRecord {
  return {
    trace_id: input.traceId,
    project_id: input.projectId,
    metadata: {},
    timestamps: {
      started_at: input.occurredAt,
      inserted_at: input.occurredAt,
      updated_at: input.occurredAt,
    },
    spans: [],
  };
}

export class TriggerSettlementNotificationService {
  private readonly email: TriggerSettlementEmailService;

  private constructor(private readonly composition: NotificationComposition) {
    this.email = TriggerSettlementEmailService.create(composition);
  }

  static create(composition: NotificationComposition): TriggerSettlementNotificationService {
    return new TriggerSettlementNotificationService(composition);
  }

  async dispatch(input: {
    projectId: string;
    triggerId: string;
    traceIds: string[];
    messageKey: string;
  }): Promise<void> {
    const trigger = await this.tryGetTrigger(input);
    if (!trigger) {
      return;
    }

    const project = await this.composition.projects.tryGetById(input.projectId);
    if (!project) {
      throw new DispatchError({
        message: `project ${input.projectId} not found at dispatch time`,
        retryable: false,
      });
    }

    const candidates = await this.confirmCandidates(input, trigger);
    if (candidates.length === 0) {
      return;
    }

    const triggerData = await this.hydrateCandidates(input.projectId, candidates);
    const context = () => this.templateContext(trigger, project, triggerData);

    const result = await this.send({
      trigger,
      triggerData,
      projectSlug: project.slug,
      projectId: input.projectId,
      messageKey: input.messageKey,
      context,
    });

    await this.claimCandidates({
      projectId: input.projectId,
      trigger,
      traceIds: candidates.map(({ traceId }) => traceId),
    });

    await this.completeDispatch({
      projectId: input.projectId,
      trigger,
      digestSize: candidates.length,
      result,
    });
  }

  private hydrateCandidates(
    projectId: string,
    candidates: ConfirmedNotificationCandidate[],
  ): Promise<SettlementNotificationCandidate[]> {
    return Promise.all(
      candidates.map(async ({ traceId, input, output, fullTrace }) => ({
        traceId,
        input,
        output,
        projectId,
        fullTrace: await this.readTrace({ projectId, traceId, fallback: fullTrace }),
      })),
    );
  }

  private templateContext(
    trigger: TriggerSummary,
    project: { name: string; slug: string },
    triggerData: SettlementNotificationCandidate[],
  ): TemplateContext {
    return buildTemplateContext({
      trigger: { id: trigger.id, name: trigger.name, alertType: trigger.alertType },
      project,
      baseHost: this.composition.baseHost,
      matches: this.templateMatches(triggerData),
    });
  }

  private async completeDispatch(input: {
    projectId: string;
    trigger: TriggerSummary;
    digestSize: number;
    result: { didSend: boolean; dropReason?: string };
  }): Promise<void> {
    const fields = {
      projectId: input.projectId,
      triggerId: input.trigger.id,
      action: input.trigger.action,
      cadence: input.trigger.notificationCadence,
    };
    if (!input.result.didSend) {
      logger.info(
        { ...fields, dropReason: input.result.dropReason },
        "Notify digest dropped (no recipients or over cap) — claimed but not sent",
      );

      return;
    }

    await this.updateLastRun(input.trigger, input.projectId);
    logger.info({ ...fields, digestSize: input.digestSize }, "Notify digest dispatched");
  }

  private async tryGetTrigger(input: {
    projectId: string;
    triggerId: string;
    traceIds: string[];
  }): Promise<TriggerSummary | null> {
    const triggers = await this.composition.automation.getActiveTraceTriggersForProject(
      input.projectId,
    );
    const trigger = triggers.find(({ id }) => id === input.triggerId) ?? null;
    if (!trigger) {
      logger.info(
        {
          projectId: input.projectId,
          triggerId: input.triggerId,
          batchSize: input.traceIds.length,
        },
        "Trigger gone / deactivated since match — dropping digest",
      );
    }

    return trigger;
  }

  private async confirmCandidates(
    input: { projectId: string; triggerId: string; traceIds: string[] },
    trigger: TriggerSummary,
  ) {
    const candidates: ConfirmedNotificationCandidate[] = [];

    for (const traceId of new Set(input.traceIds)) {
      const foldState = await this.composition.traces.tryGetSummary({
        projectId: input.projectId,
        traceId,
      });
      if (!foldState) {
        logger.debug(
          { projectId: input.projectId, triggerId: input.triggerId, traceId },
          "Trace fold gone before dispatch — skipping match",
        );
        continue;
      }

      const confirmed = await this.composition.confirmation.confirms({
        trigger,
        projectId: input.projectId,
        traceId,
        foldState,
      });
      if (!confirmed) {
        continue;
      }

      const alreadySent = await this.composition.automation.isSendClaimed({
        triggerId: input.triggerId,
        traceId,
        projectId: input.projectId,
      });
      if (alreadySent) {
        continue;
      }

      candidates.push({
        traceId,
        input: foldState.computedInput ?? "",
        output: foldState.computedOutput ?? "",
        fullTrace: fallbackTrace({
          projectId: input.projectId,
          traceId,
          occurredAt: foldState.occurredAt,
        }),
      });
    }

    return candidates;
  }

  private async readTrace(input: {
    projectId: string;
    traceId: string;
    fallback: TraceRecord;
  }): Promise<TraceRecord> {
    try {
      return await this.composition.traces.getById({
        projectId: input.projectId,
        traceId: input.traceId,
      });
    } catch (error) {
      if (error instanceof TraceNotFoundError) {
        return input.fallback;
      }

      throw error;
    }
  }

  private templateMatches(triggerData: SettlementNotificationCandidate[]): TemplateMatchInput[] {
    return triggerData.map(({ traceId, input, output, fullTrace }) => ({
      traceId,
      input,
      output,
      metadata: fullTrace.metadata,
    }));
  }

  private async send(input: {
    trigger: TriggerSummary;
    triggerData: SettlementNotificationCandidate[];
    projectSlug: string;
    projectId: string;
    messageKey: string;
    context: () => TemplateContext;
  }): Promise<{ didSend: boolean; dropReason?: string }> {
    switch (input.trigger.action) {
      case "SEND_EMAIL":
        return this.email.send(input);
      case "SEND_SLACK_MESSAGE":
        await this.sendSlack(input);
        return { didSend: true };
      case "SEND_WEBHOOK":
        await this.sendWebhook(input);
        return { didSend: true };
      default:
        throw new DispatchError({
          message: `notify digest cannot dispatch action ${input.trigger.action} — match subscriber misrouted`,
          retryable: false,
        });
    }
  }

  private async sendSlack(input: {
    trigger: TriggerSummary;
    triggerData: SettlementNotificationCandidate[];
    projectSlug: string;
    projectId: string;
    context: () => TemplateContext;
  }): Promise<void> {
    const parsed = slackActionParamsSchema.safeParse(input.trigger.actionParams);
    if (!parsed.success) {
      throw actionParamsError(input.trigger);
    }

    if (slackDeliveryMethodOf(parsed.data) === "bot") {
      const token = this.composition.slack.tryDecrypt(parsed.data);
      const channel = parsed.data.slackChannelId?.trim();
      if (!token || !channel) {
        throw actionParamsError(input.trigger);
      }

      const rendered = await renderTriggerSlack({
        templateType:
          input.trigger.templates.slackTemplateType === "block_kit" ? "block_kit" : "string",
        template: input.trigger.templates.slackTemplate,
        context: input.context(),
        allowGatedBlocks: true,
      });
      await this.composition.delivery.sendSlackBot({
        token,
        channel,
        payload: rendered.payload,
        triggerName: input.trigger.name,
      });

      return;
    }

    if (input.trigger.templates.slackTemplate !== null) {
      const rendered = await renderTriggerSlack({
        templateType:
          input.trigger.templates.slackTemplateType === "block_kit" ? "block_kit" : "string",
        template: input.trigger.templates.slackTemplate,
        context: input.context(),
      });
      await this.composition.delivery.sendSlackWebhook({
        webhook: parsed.data.slackWebhook ?? "",
        triggerName: input.trigger.name,
        payload: rendered.payload,
      });

      return;
    }

    await this.composition.delivery.sendLegacySlackWebhook({
      webhook: parsed.data.slackWebhook ?? "",
      triggerData: input.triggerData,
      triggerName: input.trigger.name,
      projectSlug: input.projectSlug,
      triggerType: input.trigger.alertType,
      triggerMessage: input.trigger.message ?? "",
      baseHost: this.composition.baseHost,
    });
  }

  private async sendWebhook(input: {
    trigger: TriggerSummary;
    projectId: string;
    messageKey: string;
    context: () => TemplateContext;
  }): Promise<void> {
    let params;
    try {
      params = this.composition.webhooks.parseStored(input.trigger.actionParams);
    } catch {
      throw actionParamsError(input.trigger);
    }

    const rendered = await renderWebhookBody({
      template: params.bodyTemplate,
      context: input.context(),
    });
    const eventId = `evt_${createHash("sha256").update(input.messageKey).digest("hex").slice(0, 32)}`;
    await this.composition.delivery.sendWebhook({
      recorder: (record) => this.composition.automation.recordWebhookDelivery(record),
      projectId: input.projectId,
      triggerId: input.trigger.id,
      eventId,
      url: params.url,
      method: params.method,
      headers: this.composition.webhooks.decryptHeaders(params),
      signingSecrets: this.composition.webhooks.decryptSigningSecrets(
        params,
        this.composition.clock.now(),
      ),
      body: rendered.body,
      triggerName: input.trigger.name,
    });
  }

  private async claimCandidates(input: {
    projectId: string;
    trigger: TriggerSummary;
    traceIds: string[];
  }): Promise<void> {
    for (const traceId of input.traceIds) {
      try {
        await this.composition.automation.claimSend({
          triggerId: input.trigger.id,
          traceId,
          projectId: input.projectId,
        });
      } catch (error) {
        this.capturePostDispatch(error, {
          projectId: input.projectId,
          triggerId: input.trigger.id,
          traceId,
          phase: "claimSend-post-dispatch",
        });
      }
    }
  }

  private async updateLastRun(trigger: TriggerSummary, projectId: string): Promise<void> {
    try {
      await this.composition.automation.updateLastRunAt({
        triggerId: trigger.id,
        projectId,
      });
    } catch (error) {
      this.capturePostDispatch(error, {
        projectId,
        triggerId: trigger.id,
        phase: "updateLastRunAt-post-dispatch",
      });
    }
  }

  private capturePostDispatch(error: unknown, context: Record<string, unknown>): void {
    const handled = error instanceof Error ? error : new Error(String(error));
    logger.warn({ ...context, error: handled.message }, "Post-dispatch bookkeeping failed");
    this.composition.observability.capture(handled, context);
  }
}
