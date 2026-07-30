export const RECORD_TRIGGER_MATCH_COMMAND_TYPE =
  "lw.automation.trigger.record_match" as const;
export const TRIGGER_MATCH_RECORDED_EVENT_TYPE =
  "lw.automation.trigger.match_recorded" as const;

/**
 * The only version this event has ever carried. It was minted at this value by
 * `RecordTriggerMatchCommand` from the commit that introduced the type
 * (ADR-052 at the time, now ADR-098; #5911) and has not been bumped since, so
 * it is the complete history
 * of what the log can hold — which is what lets the event schema assert it as a
 * literal, constraining the mint site at compile time.
 *
 * It constrains nothing at READ time: materialisation casts the row rather than
 * parsing it, so a committed match is reinterpreted as the current shape
 * whatever version string it carries. Bumping therefore means ADDING a version
 * alongside this one and widening that assertion to a union, and only for a
 * change old payloads still read correctly under; an incompatible payload
 * change needs a NEW EVENT TYPE, not a new version. Replacing this value would
 * leave the mint site asserting a version the committed history does not have.
 * See `evaluation-processing/schemas/constants.ts` for the full doctrine.
 */
export const TRIGGER_MATCH_RECORDED_EVENT_VERSION_LATEST =
  "2026-07-18" as const;

/**
 * Append-coalescing bound for recordTriggerMatch (ADR-099). A hot
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
