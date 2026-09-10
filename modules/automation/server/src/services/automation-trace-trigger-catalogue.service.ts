import type { TriggerSummary } from "@langwatch/automation-contract";
import type { AutomationClock } from "../app/automation.infrastructure.ts";
import { AutomationTraceTriggerCatalogue } from "../ports/automation-trace-trigger-catalogue.port.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";
import { ActiveTriggerCacheService } from "./active-trigger-cache.service.ts";

/**
 * A project's trace automations, read the way the ingestion path needs them.
 *
 * SAME CACHE, SAME WINDOW as the wide service - two caches over one table
 * would give one process two different ideas of which automations are live.
 * One minute of staleness is the deliberate, inherited cost.
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

  getActiveTraceTriggersForProject(projectId: string): Promise<TriggerSummary[]> {
    return this.active.getActiveTraceTriggersForProject(projectId);
  }
}
