import type { TriggerSummary } from "@langwatch/automation-contract";

// Minimal port for listing which automations watch traces; avoids pulling in the
// full authoring service for ingest-only processes.
export abstract class AutomationTraceTriggerCatalogue {
  abstract findActiveTraceTriggersForProject(projectId: string): Promise<TriggerSummary[]>;
}
