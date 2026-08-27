import type { WebhookDeliveryInput } from "@langwatch/automation-contract";
import type { AutomationClock } from "../ports/automation-clock.port";
import { AutomationGraphDeliveryPort } from "../ports/automation-graph-delivery.port";
import { PrismaEmailSuppressionRepository } from "../repositories/prisma/prisma.email-suppression.repository";
import { PrismaTriggerRepository } from "../repositories/prisma/prisma.trigger.repository";
import { PrismaWebhookDeliveryRepository } from "../repositories/prisma/prisma.webhook-delivery.repository";
import type { EmailSuppressionRepository } from "../repositories/email-suppression.repository";
import type { TriggerRepository } from "../repositories/trigger.repository";
import type { WebhookDeliveryRepository } from "../repositories/webhook-delivery.repository";

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Process-composition adapter for graph delivery's Automation persistence. */
export class PostgresAutomationGraphDeliveryAdapter extends AutomationGraphDeliveryPort {
  private constructor(
    private readonly triggers: TriggerRepository,
    private readonly suppressions: EmailSuppressionRepository,
    private readonly webhookDeliveries: WebhookDeliveryRepository,
  ) {
    super();
  }

  static create(input: {
    database: object;
    clock: AutomationClock;
  }): PostgresAutomationGraphDeliveryAdapter {
    return new PostgresAutomationGraphDeliveryAdapter(
      PrismaTriggerRepository.create(input.database, input.clock),
      PrismaEmailSuppressionRepository.create(input.database),
      PrismaWebhookDeliveryRepository.create(input.database),
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
