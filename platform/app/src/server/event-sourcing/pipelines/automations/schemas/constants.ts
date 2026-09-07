export const RECORD_TRIGGER_MATCH_COMMAND_TYPE =
  "lw.automation.trigger.record_match" as const;
export const TRIGGER_MATCH_RECORDED_EVENT_TYPE =
  "lw.automation.trigger.match_recorded" as const;

/**
 * Append-coalescing bound for recordTriggerMatch (ADR-066 pillar 2). A hot
 * trigger records one match per trace; at high fan-in that is one tiny
 * event_log insert per match, which floods the log with small parts. Folding up
 * to this many same-trigger matches into a single multi-row insert keeps the
 * producer off the per-item write path. Mirrors LOG/METRIC_MAP_COALESCE_MAX_BATCH
 * (256) at a slightly lower count — a byte bound backs it up in the drain.
 */
export const TRIGGER_MATCH_COALESCE_MAX_BATCH = 200;

export const AUTOMATIONS_COMMAND_TYPES = [
  RECORD_TRIGGER_MATCH_COMMAND_TYPE,
] as const;
export const AUTOMATIONS_EVENT_TYPES = [
  TRIGGER_MATCH_RECORDED_EVENT_TYPE,
] as const;
