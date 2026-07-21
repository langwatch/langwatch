export const RECORD_TRIGGER_MATCH_COMMAND_TYPE =
  "lw.automation.trigger.record_match" as const;
export const TRIGGER_MATCH_RECORDED_EVENT_TYPE =
  "lw.automation.trigger.match_recorded" as const;

export const AUTOMATIONS_COMMAND_TYPES = [
  RECORD_TRIGGER_MATCH_COMMAND_TYPE,
] as const;
export const AUTOMATIONS_EVENT_TYPES = [
  TRIGGER_MATCH_RECORDED_EVENT_TYPE,
] as const;
