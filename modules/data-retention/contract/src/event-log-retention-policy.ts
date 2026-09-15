import type { RetentionCategory } from "./data-retention.ts";

/**
 * `event_log` cannot be classified table-wide the way every other
 * retention-managed ClickHouse table is: one row is a trace event, the next
 * is a scenario run, the next is a durable identity/authorization record that
 * must never expire. Every row is classified on its own terms instead, by the
 * aggregate it belongs to (falling back to the matching event-type prefix for
 * a row whose aggregate is missing or unrecognised) — never by the table.
 */
export type EventLogRetentionClass = RetentionCategory | "indefinite";

/**
 * Security event-type prefixes that must remain durable even if an old or
 * malformed row carries an unexpected aggregate type. Aggregate
 * classification remains the normal path; these prefixes are the safety net
 * for identity and authorisation history.
 */
export const INDEFINITE_EVENT_TYPE_PREFIXES = ["lw.identity.", "lw.authz."] as const;

/** Security events that share an aggregate with policy-bound operational events. */
export const INDEFINITE_EVENT_TYPES = ["lw.governance.vk_lifecycle"] as const;

/**
 * Every aggregate type this deployment's event-sourcing runtime registers,
 * assigned to its retention class deliberately. An aggregate not listed here
 * falls back to `"traces"` at runtime in {@link classifyEventLogRowRetention}
 * — the conservative choice for a row whose contents have not been inspected,
 * never `"indefinite"` by omission.
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
 * Classifies one `event_log` row for retention. Checked in order: the
 * event-type prefix safety net, the exact virtual-key-lifecycle exception,
 * then the aggregate map — an unrecognised aggregate is `"traces"`, never
 * `"indefinite"`, because indefinite retention is opted into by name, not
 * assumed for the unknown.
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
