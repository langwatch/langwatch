import type { AutomationClockPort } from "../ports/automation-clock.port.ts";
import {
  PrismaEmailSuppressionRepository,
  type EmailSuppressionDatabase,
} from "../repositories/prisma/prisma.email-suppression.repository.ts";
import {
  PrismaTriggerRepository,
  type TriggerDatabase,
} from "../repositories/prisma/prisma.trigger.repository.ts";
import {
  PrismaWebhookDeliveryRepository,
  type WebhookDeliveryDatabase,
} from "../repositories/prisma/prisma.webhook-delivery.repository.ts";
import { AutomationGraphDeliveryService } from "../services/automation-graph-delivery.service.ts";

/** Process-composition shim for graph delivery's Automation persistence. */
export class PostgresAutomationGraphDeliveryAdapter {
  static create(input: {
    database: TriggerDatabase & EmailSuppressionDatabase & WebhookDeliveryDatabase;
    clock: AutomationClockPort;
  }): AutomationGraphDeliveryService {
    return AutomationGraphDeliveryService.create({
      triggers: PrismaTriggerRepository.create(input.database, input.clock),
      suppressions: PrismaEmailSuppressionRepository.create(input.database),
      webhookDeliveries: PrismaWebhookDeliveryRepository.create(input.database),
    });
  }
}
