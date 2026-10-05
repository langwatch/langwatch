import type { AutomationPersistCapBreach } from "@langwatch/automation-contract";

import { AutomationSettlementBreach } from "../repositories/automation-settlement-ledger.repository.ts";
import type { AutomationLogger } from "./automation.service.ts";

/**
 * A breach with no containment composed: logged, nobody notified, nothing paused
 * (main's WorkerSettlementBreach; containment is a named parity gap).
 */
export class AutomationSettlementBreachLoggedService extends AutomationSettlementBreach {
  static create(logger: AutomationLogger): AutomationSettlementBreachLoggedService {
    return new AutomationSettlementBreachLoggedService(logger);
  }

  private constructor(private readonly logger: AutomationLogger) {
    super();
  }

  handle(input: AutomationPersistCapBreach): Promise<void> {
    this.logger.error(
      {
        projectId: input.projectId,
        triggerId: input.trigger.id,
        cap: input.cap,
        count: input.count,
        skipped: input.skipped,
      },
      "Automation passed its daily ceiling on confirmed matches and further matches are being skipped; this process composed no containment, so nobody has been notified and the automation has not been paused",
    );
    return Promise.resolve();
  }
}
