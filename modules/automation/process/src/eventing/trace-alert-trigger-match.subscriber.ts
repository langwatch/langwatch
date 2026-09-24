import {
  NOTIFY_TRIGGER_ACTIONS,
  triggerFiltersNeedEvaluation,
  type AutomationEvaluationSubscriberEvent,
  type AutomationTraceSubscriberContext,
} from "@langwatch/automation-contract";

import type { AutomationTriggerMatchRecorder } from "../app/automation.members.ts";
import type { AutomationTraceTriggerCatalogue } from "../repositories/automation-trace-trigger-catalogue.repository.ts";

/** Port of main's trace `triggerMatch` subscriber; trace applies its origin guard first. */
export async function handleTraceAlertTriggerMatch(
  deps: {
    triggers: Pick<AutomationTraceTriggerCatalogue, "findActiveTraceTriggersForProject">;
    triggerMatches: AutomationTriggerMatchRecorder;
  },
  event: AutomationEvaluationSubscriberEvent,
  context: AutomationTraceSubscriberContext,
): Promise<void> {
  const traceId = context.aggregateId;
  if (!traceId) return;

  const triggers = await deps.triggers.findActiveTraceTriggersForProject(context.tenantId);
  for (const trigger of triggers) {
    if (triggerFiltersNeedEvaluation(trigger.filters)) continue;
    await deps.triggerMatches.send({
      tenantId: context.tenantId,
      occurredAt: event.occurredAt,
      triggerId: trigger.id,
      traceId,
      action: trigger.action,
      actionClass: NOTIFY_TRIGGER_ACTIONS.has(trigger.action) ? "notify" : "persist",
      traceDebounceMs: trigger.traceDebounceMs,
      notificationCadence: trigger.notificationCadence,
    });
  }
}
