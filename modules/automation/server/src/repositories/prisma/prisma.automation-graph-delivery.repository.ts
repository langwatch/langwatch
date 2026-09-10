import type { AutomationClock } from "../../app/automation.infrastructure.ts";
import {
  PrismaEmailSuppressionRepository,
  type EmailSuppressionDatabase,
} from "./prisma.email-suppression.repository.ts";
import {
  PrismaTriggerRepository,
  type TriggerDatabase,
} from "./prisma.trigger.repository.ts";
import {
  PrismaWebhookDeliveryRepository,
  type WebhookDeliveryDatabase,
} from "./prisma.webhook-delivery.repository.ts";
import { AutomationGraphDeliveryService } from "../../services/automation-graph-delivery.service.ts";

/** Process-composition shim for graph delivery's Automation persistence. */
export class PrismaAutomationGraphDeliveryRepository {
  static create(input: {
    database: TriggerDatabase & EmailSuppressionDatabase & WebhookDeliveryDatabase;
    clock: AutomationClock;
  }): AutomationGraphDeliveryService {
    return AutomationGraphDeliveryService.create({
      triggers: PrismaTriggerRepository.create(input.database, input.clock),
      suppressions: PrismaEmailSuppressionRepository.create(input.database),
      webhookDeliveries: PrismaWebhookDeliveryRepository.create(input.database),
    });
  }
}
