import { createHash } from "node:crypto";
import {
  emailActionParamsSchema,
  renderTriggerEmail,
  type TemplateContext,
  type TriggerSummary,
} from "@langwatch/automation-contract";
import type { AutomationService } from "@langwatch/automation-contract";
import { DispatchError } from "@langwatch/eventing";
import type { TraceRecord } from "@langwatch/trace-contract";
import type { AutomationClock } from "../ports/automation-clock.port";
import type { AutomationNotificationDeliveryPort } from "../ports/automation-notification-delivery.port";
import type { AutomationEmailCapService } from "./email-cap.service";

export type SettlementNotificationCandidate = {
  traceId: string;
  input: string;
  output: string;
  projectId: string;
  fullTrace: TraceRecord;
};

type EmailComposition = {
  automation: AutomationService;
  delivery: AutomationNotificationDeliveryPort;
  emailCaps: AutomationEmailCapService;
  clock: AutomationClock;
  emailHourlyCap: number;
  tenantDailyCap: number;
};

export class TriggerSettlementEmailService {
  private constructor(private readonly composition: EmailComposition) {}

  static create(composition: EmailComposition): TriggerSettlementEmailService {
    return new TriggerSettlementEmailService(composition);
  }

  async send(input: {
    trigger: TriggerSummary;
    triggerData: SettlementNotificationCandidate[];
    projectSlug: string;
    projectId: string;
    context: () => TemplateContext;
  }): Promise<{ didSend: boolean; dropReason?: string }> {
    const parsed = emailActionParamsSchema.safeParse(input.trigger.actionParams);
    if (!parsed.success) {
      throw new DispatchError({
        message: `Automation trigger "${input.trigger.name}" has invalid ${input.trigger.action} action parameters`,
        retryable: false,
      });
    }

    const digest = this.dispatchDigest(input.triggerData);
    const eligibility = await this.resolveEligibility({
      projectId: input.projectId,
      triggerId: input.trigger.id,
      emails: parsed.data.members,
      digest,
    });
    if (!eligibility.recipients) {
      return { didSend: false, dropReason: eligibility.dropReason };
    }

    const recipients = eligibility.recipients;
    const recipientClaims = this.recipientClaims(input.trigger, input.projectId, digest);
    const templates = input.trigger.templates;
    const custom = templates.emailSubjectTemplate !== null || templates.emailBodyTemplate !== null;
    if (custom) {
      const rendered = await renderTriggerEmail({
        subjectTemplate: templates.emailSubjectTemplate,
        bodyTemplate: templates.emailBodyTemplate,
        context: input.context(),
      });
      await this.composition.delivery.sendEmail({
        recipients,
        triggerId: input.trigger.id,
        projectId: input.projectId,
        subject: rendered.subject,
        html: rendered.html,
        ...recipientClaims,
      });

      return { didSend: true };
    }

    await this.composition.delivery.sendLegacyEmail({
      recipients,
      triggerData: input.triggerData,
      triggerName: input.trigger.name,
      triggerId: input.trigger.id,
      projectId: input.projectId,
      projectSlug: input.projectSlug,
      triggerType: input.trigger.alertType,
      triggerMessage: input.trigger.message ?? "",
      ...recipientClaims,
    });

    return { didSend: true };
  }

  private async resolveEligibility(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
    digest: string;
  }): Promise<{ recipients: string[] | null; dropReason?: string }> {
    const recipients = await this.composition.automation.filterSuppressed({
      projectId: input.projectId,
      triggerId: input.triggerId,
      emails: input.emails,
    });
    if (recipients.length === 0) {
      return { recipients: null, dropReason: "dropped: all recipients suppressed" };
    }

    const hourly = await this.composition.emailCaps.consumeHourly({
      projectId: input.projectId,
      triggerId: input.triggerId,
      now: this.composition.clock.now(),
      cap: this.composition.emailHourlyCap,
      dedupKey: `${input.projectId}/${input.triggerId}:digest:${input.digest}`,
    });
    if (!hourly.allowed) {
      return { recipients: null, dropReason: "dropped: over hourly cap" };
    }

    const daily = await this.composition.emailCaps.consumeDaily({
      projectId: input.projectId,
      now: this.composition.clock.now(),
      cap: this.composition.tenantDailyCap,
      recipientCount: recipients.length,
      dedupKey: `${input.projectId}:tenant:${input.triggerId}:${input.digest}`,
    });
    if (!daily.allowed) {
      return { recipients: null, dropReason: "dropped: over project daily email cap" };
    }

    return { recipients };
  }

  private recipientClaims(trigger: TriggerSummary, projectId: string, digest: string) {
    const recipientClaimKey = (recipientHash: string) => `rcpt:${digest}:${recipientHash}`;

    return {
      isRecipientSent: (recipientHash: string) =>
        this.composition.automation.isSendClaimed({
          triggerId: trigger.id,
          traceId: recipientClaimKey(recipientHash),
          projectId,
        }),
      recordRecipientSent: async (recipientHash: string) => {
        await this.composition.automation.claimSend({
          triggerId: trigger.id,
          traceId: recipientClaimKey(recipientHash),
          projectId,
        });
      },
    };
  }

  private dispatchDigest(triggerData: SettlementNotificationCandidate[]): string {
    const sortedTraceIds = triggerData.map(({ traceId }) => traceId).sort();

    return createHash("sha256").update(sortedTraceIds.join(",")).digest("hex").slice(0, 16);
  }
}
