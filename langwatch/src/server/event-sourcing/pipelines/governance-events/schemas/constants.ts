export const GOVERNANCE_EVENTS_PIPELINE_NAME =
  "governance_events_processing" as const;
export const GOVERNANCE_EVENTS_AGGREGATE_TYPE =
  "governance_subject" as const;

export const RECORD_VK_LIFECYCLE_COMMAND_TYPE =
  "lw.governance.record_vk_lifecycle" as const;
export const RECORD_BUDGET_CROSSING_COMMAND_TYPE =
  "lw.governance.record_budget_crossing" as const;

export const GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE =
  "lw.governance.vk_lifecycle" as const;
export const GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE =
  "lw.governance.budget_crossing" as const;

/** Schema-snapshot version (calendar date), per the event-store convention. */
export const GOVERNANCE_EVENTS_EVENT_VERSION_LATEST = "2026-07-31" as const;

export const GOVERNANCE_EVENTS_COMMAND_TYPES = [
  RECORD_VK_LIFECYCLE_COMMAND_TYPE,
  RECORD_BUDGET_CROSSING_COMMAND_TYPE,
] as const;

export const GOVERNANCE_EVENTS_EVENT_TYPES = [
  GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE,
  GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE,
] as const;
