import type { ProcessStore } from "@langwatch/eventing";

import type { AutomationCallCounterRepository } from "./automation-call-counter.repository.ts";
import type { AutomationContainmentClaimRepository } from "./automation-containment-claim.repository.ts";
import type { AutomationEmailCapRepository } from "./automation-email-cap.repository.ts";
import type { AutomationPersistCapRepository } from "./automation-persist-cap.repository.ts";
import type { CustomGraphRepository } from "./custom-graph.repository.ts";
import type { EmailSuppressionNameRepository } from "./email-suppression-name.repository.ts";
import type { EmailSuppressionRepository } from "./email-suppression.repository.ts";
import type { GraphTriggerSentRepository } from "./graph-trigger-sent.repository.ts";
import type { TriggerFireHistoryRepository } from "./trigger-fire-history.repository.ts";
import type { TriggerRepository } from "./trigger.repository.ts";

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
  readonly graphTriggerSent: GraphTriggerSentRepository;
  readonly persistCaps: AutomationPersistCapRepository;
  readonly callCounter: AutomationCallCounterRepository;
  readonly containmentClaims: AutomationContainmentClaimRepository;
  readonly emailCaps: AutomationEmailCapRepository;
  /** The report schedules' process-manager rows, read on every role (the api hosts no pipeline). */
  readonly processStore: Pick<ProcessStore, "findByRef">;
}
