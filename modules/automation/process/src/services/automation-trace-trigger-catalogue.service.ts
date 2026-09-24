import type { TriggerSummary } from "@langwatch/automation-contract";

import type { AutomationClock } from "../app/automation.members.ts";
import { AutomationTraceTriggerCatalogue } from "../repositories/automation-trace-trigger-catalogue.repository.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";
import { ActiveTriggerCacheService } from "./active-trigger-cache.service.ts";

/**
 * A project's trace automations, read the way ingestion needs them.
 * SAME CACHE, SAME WINDOW as the wide service, so one process can't hold
 * two ideas of which automations are live; staleness is one minute.
 */
export class AutomationTraceTriggerCatalogueService extends AutomationTraceTriggerCatalogue {
  static create(input: {
    triggers: TriggerRepository;
    clock: AutomationClock;
  }): AutomationTraceTriggerCatalogueService {
    return new AutomationTraceTriggerCatalogueService(
      ActiveTriggerCacheService.create({ triggers: input.triggers, clock: input.clock }),
    );
  }

  private constructor(private readonly active: ActiveTriggerCacheService) {
    super();
  }

  findActiveTraceTriggersForProject(projectId: string): Promise<TriggerSummary[]> {
    return this.active.getActiveTraceTriggersForProject(projectId);
  }
}
