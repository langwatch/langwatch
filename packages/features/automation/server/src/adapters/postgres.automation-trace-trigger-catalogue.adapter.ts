import type { TriggerSummary } from "@langwatch/automation-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { AutomationTraceTriggerCataloguePort } from "../ports/automation-trace-trigger-catalogue.port";
import type { AutomationClockPort } from "../ports/automation-clock.port";
import { PrismaTriggerRepository } from "../repositories/prisma/prisma.trigger.repository";
import { ActiveTriggerCacheService } from "../services/active-trigger-cache.service";

/**
 * The one table this read touches, named here and nowhere above it.
 */
export type AutomationTraceTriggerCatalogueDatabase = Pick<PrismaClient, "trigger">;

/**
 * A project's trace automations, read the way the ingestion path needs them.
 *
 * SAME CACHE, SAME WINDOW as the wide service. `ActiveTriggerCacheService` is
 * what holds a project's active list for a minute, and it is composed here
 * rather than re-implemented, because two caches over one table would give one
 * process two different ideas of which automations are live — a trace could
 * then match an automation the graph half had already seen deleted.
 *
 * ONE MINUTE OF STALENESS IS THE DELIBERATE COST, inherited rather than
 * introduced: a newly saved automation may not fire for up to a minute in a
 * process that has already read the project. That was already true of every
 * pod in a multi-pod deployment.
 */
export class PostgresAutomationTraceTriggerCatalogueAdapter extends AutomationTraceTriggerCataloguePort {
  static create(input: {
    /** The one database client the composing process opened. */
    prisma: AutomationTraceTriggerCatalogueDatabase;
    clock: AutomationClockPort;
  }): PostgresAutomationTraceTriggerCatalogueAdapter {
    return new PostgresAutomationTraceTriggerCatalogueAdapter(
      ActiveTriggerCacheService.create({
        triggers: PrismaTriggerRepository.create(input.prisma, input.clock),
        clock: input.clock,
      }),
    );
  }

  private constructor(private readonly active: ActiveTriggerCacheService) {
    super();
  }

  getActiveTraceTriggersForProject(projectId: string): Promise<TriggerSummary[]> {
    return this.active.getActiveTraceTriggersForProject(projectId);
  }
}
