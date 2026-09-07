import type { AggregateType } from "../event-sourcing/domain/aggregateType";
import type { RetentionCategory } from "./retentionPolicy.schema";

export type EventLogRetentionClass = RetentionCategory | "indefinite";

/**
 * Event-type prefixes that must remain durable even if an old or malformed
 * row carries an unexpected aggregate type. Aggregate classification remains
 * the normal path; these prefixes are the safety net for control-plane logs.
 */
const INDEFINITE_EVENT_TYPE_PREFIXES = ["lw.identity.", "lw.authz.", "lw.governance."] as const;

/**
 * Every aggregate type registered with the event-sourcing runtime is assigned
 * deliberately. The `satisfies` check makes a newly registered aggregate a
 * compile error here instead of silently inheriting the traces policy.
 *
 * Unknown historical rows still fall back to traces at runtime. That is the
 * conservative choice for payloads whose contents have not been inspected.
 */
const RETENTION_CLASS_BY_AGGREGATE_TYPE = {
  authz_grant: "indefinite",
  authz_role: "indefinite",
  user_identity: "indefinite",
  sso_connection: "indefinite",
  join_request: "indefinite",
  scim_sync: "indefinite",
  trigger: "indefinite",
  trace: "traces",
  metric: "traces",
  log: "traces",
  coding_agent_session: "indefinite",
  evaluation: "traces",
  experiment_run: "experiments",
  simulation_run: "scenarios",
  simulation_set: "scenarios",
  suite_run: "scenarios",
  langy_conversation: "traces",
  topic_clustering: "traces",
  ingestion_pull: "indefinite",
  pulled_usage: "indefinite",
  billing_report: "traces",
  gateway_request: "indefinite",
  governance_subject: "indefinite",
  global: "traces",
  test_aggregate: "traces",
} as const satisfies Record<AggregateType, EventLogRetentionClass>;

export function classifyEventLogRowRetention(row: {
  AggregateType: string;
  EventType: string;
}): EventLogRetentionClass {
  if (INDEFINITE_EVENT_TYPE_PREFIXES.some((prefix) => row.EventType.startsWith(prefix))) {
    return "indefinite";
  }

  return RETENTION_CLASS_BY_AGGREGATE_TYPE[row.AggregateType as AggregateType] ?? "traces";
}

function sqlStringLiteral(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `'${escaped}'`;
}

function aggregateTypesFor(retentionClass: EventLogRetentionClass): string[] {
  return Object.entries(RETENTION_CLASS_BY_AGGREGATE_TYPE)
    .filter(([, candidate]) => candidate === retentionClass)
    .map(([aggregateType]) => aggregateType);
}

function aggregateTypeListSql(aggregateTypes: string[]): string {
  return aggregateTypes.map(sqlStringLiteral).join(", ");
}

const eventTypePrefixSql = INDEFINITE_EVENT_TYPE_PREFIXES.map(
  (prefix) => `startsWith(EventType, ${sqlStringLiteral(prefix)})`,
).join(" OR ");

const indefiniteAggregateTypesSql = aggregateTypeListSql(aggregateTypesFor("indefinite"));

/** Exact ClickHouse predicate for rows that must never expire. */
export const EVENT_LOG_INDEFINITE_RETENTION_SQL_PREDICATE =
  `(${eventTypePrefixSql} OR ` + `AggregateType IN (${indefiniteAggregateTypesSql}))`;

/**
 * ClickHouse predicate selecting the finite-policy rows for one customer
 * retention category. It is generated from the same exhaustive map used by
 * ingestion, so retroactive updates cannot overwrite indefinite rows or move
 * scenario and experiment events onto the traces policy.
 */
export function eventLogRetentionCategorySqlPredicate(category: RetentionCategory): string {
  const finiteGuard = `NOT ${EVENT_LOG_INDEFINITE_RETENTION_SQL_PREDICATE}`;

  if (category === "traces") {
    const otherFiniteAggregateTypes = [
      ...aggregateTypesFor("scenarios"),
      ...aggregateTypesFor("experiments"),
    ].sort();
    return (
      `${finiteGuard} AND ` +
      `AggregateType NOT IN (${aggregateTypeListSql(otherFiniteAggregateTypes)})`
    );
  }

  return (
    `${finiteGuard} AND ` +
    `AggregateType IN (${aggregateTypeListSql(aggregateTypesFor(category))})`
  );
}
