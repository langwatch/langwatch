import type { WebhookDeliveryInput } from "@langwatch/automation-contract";
import { AutomationGraphDelivery } from "../app/automation.infrastructure.ts";
import type { EmailSuppressionRepository } from "../repositories/email-suppression.repository.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";
import type { WebhookDeliveryRepository } from "../repositories/webhook-delivery.repository.ts";

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Graph delivery's Automation persistence, over repository interfaces only. */
export class AutomationGraphDeliveryService implements AutomationGraphDelivery {
  private constructor(
    private readonly triggers: TriggerRepository,
    private readonly suppressions: EmailSuppressionRepository,
    private readonly webhookDeliveries: WebhookDeliveryRepository,
  ) {
  }

  static create(input: {
    triggers: TriggerRepository;
    suppressions: EmailSuppressionRepository;
    webhookDeliveries: WebhookDeliveryRepository;
  }): AutomationGraphDeliveryService {
    return new AutomationGraphDeliveryService(
      input.triggers,
      input.suppressions,
      input.webhookDeliveries,
    );
  }

  async filterSuppressed(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]> {
    const rows = await this.suppressions.findMatching(input);
    const blocked = new Set(rows.map((row) => normalizeEmail(row.email)));
    return input.emails.filter((email) => !blocked.has(normalizeEmail(email)));
  }

  isSendClaimed(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return this.triggers.isSendClaimed(input);
  }

  claimSend(input: { triggerId: string; traceId: string; projectId: string }): Promise<boolean> {
    return this.triggers.claimSend(input);
  }

  recordWebhookDelivery(input: WebhookDeliveryInput): Promise<void> {
    return this.webhookDeliveries.create(input);
  }
}
