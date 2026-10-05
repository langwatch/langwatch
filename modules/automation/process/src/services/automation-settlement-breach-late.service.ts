import type { AutomationPersistCapBreach } from "@langwatch/automation-contract";

import { AutomationSettlementBreach } from "../repositories/automation-settlement-ledger.repository.ts";
import type { RunawayContainmentService } from "./runaway-containment.service.ts";

/**
 * The breach handler, resolved LATE: containment reads suppression rows
 * off the ledger this port is handed to, so the thunk is the knot, not an
 * optional. Absent containment, this process's own report stands.
 */
export class AutomationSettlementBreachLateService extends AutomationSettlementBreach {
  static create(input: {
    reported: AutomationSettlementBreach;
    resolve: () => RunawayContainmentService | undefined;
  }): AutomationSettlementBreachLateService {
    return new AutomationSettlementBreachLateService(input.reported, input.resolve);
  }

  private constructor(
    private readonly reported: AutomationSettlementBreach,
    private readonly resolve: () => RunawayContainmentService | undefined,
  ) {
    super();
  }

  async handle(breach: AutomationPersistCapBreach): Promise<void> {
    const containment = this.resolve();
    if (containment) return containment.handle(breach);

    return this.reported.handle(breach);
  }
}
