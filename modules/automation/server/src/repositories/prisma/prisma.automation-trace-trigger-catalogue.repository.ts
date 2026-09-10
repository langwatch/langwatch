import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AutomationClock } from "../../app/automation.infrastructure.ts";
import { PrismaTriggerRepository } from "./prisma.trigger.repository.ts";
import { AutomationTraceTriggerCatalogueService } from "../../services/automation-trace-trigger-catalogue.service.ts";

/**
 * The one table this read touches, named here and nowhere above it.
 */
export type AutomationTraceTriggerCatalogueDatabase = Pick<
  PrismaClient,
  "trigger" | "triggerSent" | "$queryRaw"
>;

/** Process-composition shim for the trace-trigger catalogue read. */
export class PrismaAutomationTraceTriggerCatalogueRepository {
  static create(input: {
    /** The one database client the composing process opened. */
    prisma: AutomationTraceTriggerCatalogueDatabase;
    clock: AutomationClock;
  }): AutomationTraceTriggerCatalogueService {
    return AutomationTraceTriggerCatalogueService.create({
      triggers: PrismaTriggerRepository.create(input.prisma, input.clock),
      clock: input.clock,
    });
  }
}
