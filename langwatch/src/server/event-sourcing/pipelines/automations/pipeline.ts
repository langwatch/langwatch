import type { ProcessManagerApplier } from "../../pipeline/processBuilder";
import { definePipeline } from "../../pipeline/staticBuilder";
import type { AppendStore } from "../../projections/mapProjection.types";
import { RecordTriggerMatchCommand } from "./commands/recordTriggerMatch.command";
import {
  createAutomationAuditMapProjection,
  type AutomationAuditRecord,
} from "./projections/automationAudit.mapProjection";
import type { AutomationEvent } from "./schemas/events";

export interface AutomationsPipelineDeps {
  automationAuditStore: AppendStore<AutomationAuditRecord>;
  triggerSettlement: ProcessManagerApplier<AutomationEvent>;
  graphAlertSweep: ProcessManagerApplier<AutomationEvent>;
  webhookDeliveryPrune: ProcessManagerApplier<AutomationEvent>;
}

export function createAutomationsPipeline(deps: AutomationsPipelineDeps) {
  return definePipeline<AutomationEvent>()
    .withName("automations")
    .withAggregateType("trigger")
    .withMapProjection(
      "automationAudit",
      createAutomationAuditMapProjection({ store: deps.automationAuditStore }),
    )
    .withCommand("recordTriggerMatch", RecordTriggerMatchCommand, {
      serializeByAggregate: true,
    })
    .withProcessManager("triggerSettlement", deps.triggerSettlement)
    .withProcessManager("graphAlertSweep", deps.graphAlertSweep)
    .withProcessManager("webhookDeliveryPrune", deps.webhookDeliveryPrune)
    .build();
}
