export { RecordTriggerMatchCommand } from "./commands/recordTriggerMatch.command";
export { createAutomationsPipeline } from "./pipeline";
export type { AutomationAuditRecord } from "./projections/automationAudit.mapProjection";
export {
  RECORD_TRIGGER_MATCH_COMMAND_TYPE,
  TRIGGER_MATCH_RECORDED_EVENT_TYPE,
} from "./schemas/constants";
export type {
  AutomationEvent,
  TriggerMatchRecordedEvent,
  TriggerMatchRecordedEventData,
} from "./schemas/events";
