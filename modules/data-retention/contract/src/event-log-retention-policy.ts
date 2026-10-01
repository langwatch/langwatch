import type { RetentionCategory } from "./data-retention.ts";

/**
 * `event_log` mixes rows with different retention needs — a trace event next
 * to a durable identity record that must never expire — so classification is
 * per-row by aggregate type, falling back to event-type prefix, never table-wide.
 */
export type EventLogRetentionClass = RetentionCategory | "indefinite";

/**
 * Security event-type prefixes that must remain durable even if an old or
 * malformed row carries an unexpected aggregate type — the safety net behind
 * normal aggregate classification for identity and authorisation history.
 */
export const INDEFINITE_EVENT_TYPE_PREFIXES = ["lw.identity.", "lw.authz."] as const;

/** Security events that share an aggregate with policy-bound operational events. */
export const INDEFINITE_EVENT_TYPES = ["lw.governance.vk_lifecycle"] as const;

/**
 * Every aggregate type this deployment's event-sourcing runtime registers,
 * assigned to its retention class. An unlisted aggregate falls back to
 * `"traces"` — the conservative choice, never `"indefinite"` by omission.
 */
export const RETENTION_CLASS_BY_AGGREGATE_TYPE: Record<string, EventLogRetentionClass> = {
  authz_grant: "indefinite",
  user_identity: "indefinite",
  sso_connection: "indefinite",
  join_request: "indefinite",
  scim_sync: "indefinite",
  trigger: "traces",
  trace: "traces",
  metric: "traces",
  log: "traces",
  coding_agent_session: "traces",
  evaluation: "traces",
  experiment_run: "experiments",
  simulation_run: "scenarios",
  simulation_set: "scenarios",
  suite_run: "scenarios",
  langy_conversation: "traces",
  topic_clustering: "traces",
  ingestion_pull: "traces",
  pulled_usage: "traces",
  billing_report: "traces",
  gateway_request: "traces",
  governance_subject: "traces",
  global: "traces",
};

/**
 * Classifies one `event_log` row for retention, checked in order: event-type
 * prefix, virtual-key-lifecycle exception, then the aggregate map. An
 * unrecognised aggregate is `"traces"`, never `"indefinite"` by default.
 */
export function classifyEventLogRowRetention(row: {
  AggregateType: string;
  EventType: string;
}): EventLogRetentionClass {
  if (INDEFINITE_EVENT_TYPE_PREFIXES.some((prefix) => row.EventType.startsWith(prefix))) {
    return "indefinite";
  }

  if (INDEFINITE_EVENT_TYPES.some((eventType) => row.EventType === eventType)) {
    return "indefinite";
  }

  if (!Object.prototype.hasOwnProperty.call(RETENTION_CLASS_BY_AGGREGATE_TYPE, row.AggregateType)) {
    return "traces";
  }

  return RETENTION_CLASS_BY_AGGREGATE_TYPE[row.AggregateType]!;
}
