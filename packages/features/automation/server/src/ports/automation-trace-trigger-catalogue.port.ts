import type { TriggerSummary } from "@langwatch/automation-contract";

/**
 * The one automation listing the trace-alert path reads.
 *
 * NOT the whole `AutomationService`, for the reason `AutomationProjectIdentityPort`
 * gives one file over: constructing that service means twelve collaborators —
 * report schedules, unsubscribe verification, webhook deliveries, persist caps,
 * the whole graph half — because its WRITE half needs them. Asking which of a
 * project's automations watch traces is a single cached repository read, and a
 * process that only ingests should not have to compose an authoring surface to
 * make it.
 *
 * `AutomationService` satisfies this, so the application's own composition is
 * unchanged and both graphs answer from the same implementation.
 */
export abstract class AutomationTraceTriggerCataloguePort {
  abstract getActiveTraceTriggersForProject(projectId: string): Promise<TriggerSummary[]>;
}
