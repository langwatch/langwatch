import type { CustomGraphRepository } from "./custom-graph.repository.ts";
import type { EmailSuppressionNameRepository } from "./email-suppression-name.repository.ts";
import type { EmailSuppressionRepository } from "./email-suppression.repository.ts";
import type { GraphTriggerSentRepository } from "./graph-trigger-sent.repository.ts";
import type { TriggerFireHistoryRepository } from "./trigger-fire-history.repository.ts";
import type { TriggerRepository } from "./trigger.repository.ts";
import type { WebhookDeliveryRepository } from "./webhook-delivery.repository.ts";

/**
 * The rows the automation module owns, chosen once at boot. Every one is
 * a store the module writes as well as reads, so this selection is what
 * the application is built from -- it names no store of its own.
 */
export interface AutomationRepositories {
  readonly triggers: TriggerRepository;
  readonly history: TriggerFireHistoryRepository;
  readonly suppressions: EmailSuppressionRepository;
  readonly names: EmailSuppressionNameRepository;
  readonly customGraphs: CustomGraphRepository;
  readonly webhookDeliveries: WebhookDeliveryRepository;
  readonly graphTriggerSent: GraphTriggerSentRepository;
}
