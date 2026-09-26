import type { AutomationRepositories } from "../automation.repositories.ts";
import { MemoryAutomationCallCounterRepository } from "./memory.automation-call-counter.repository.ts";
import { MemoryAutomationContainmentClaimRepository } from "./memory.automation-containment-claim.repository.ts";
import { MemoryAutomationEmailCapRepository } from "./memory.automation-email-cap.repository.ts";
import { MemoryAutomationPersistCapRepository } from "./memory.automation-persist-cap.repository.ts";
import { MemoryAutomationWebhookRateLimitRepository } from "./memory.automation-webhook-rate-limit.repository.ts";
import { MemoryAutomationStore } from "./memory.automation.store.ts";
import { MemoryCustomGraphRepository } from "./memory.custom-graph.repository.ts";
import { MemoryEmailSuppressionNameRepository } from "./memory.email-suppression-name.repository.ts";
import { MemoryEmailSuppressionRepository } from "./memory.email-suppression.repository.ts";
import { MemoryGraphTriggerSentRepository } from "./memory.graph-trigger-sent.repository.ts";
import { MemoryTriggerFireHistoryRepository } from "./memory.trigger-fire-history.repository.ts";
import { MemoryTriggerRepository } from "./memory.trigger.repository.ts";
import { MemoryWebhookDeliveryRepository } from "./memory.webhook-delivery.repository.ts";

/** The "memory" tier: every automation row the app is tested without a database. */
export class MemoryAutomationRepositories {
  static readonly requires = [] as const;

  static create(): AutomationRepositories {
    // One store behind all seven rows, the way one database serves them: a
    // trigger written through `triggers` is the trigger `names` answers with
    // and the trigger a graph incident is opened against.
    const memory = MemoryAutomationStore.create();

    return {
      triggers: MemoryTriggerRepository.create(memory),
      history: MemoryTriggerFireHistoryRepository.create(memory),
      suppressions: MemoryEmailSuppressionRepository.create(memory),
      names: MemoryEmailSuppressionNameRepository.create(memory),
      customGraphs: MemoryCustomGraphRepository.create(memory),
      webhookDeliveries: MemoryWebhookDeliveryRepository.create(memory),
      graphTriggerSent: MemoryGraphTriggerSentRepository.create(memory),
      persistCaps: MemoryAutomationPersistCapRepository.create(),
      callCounter: MemoryAutomationCallCounterRepository.create(),
      webhookRateLimits: MemoryAutomationWebhookRateLimitRepository.create(),
      containmentClaims: MemoryAutomationContainmentClaimRepository.create(),
      emailCaps: MemoryAutomationEmailCapRepository.create(),
    };
  }
}
