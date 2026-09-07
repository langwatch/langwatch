import type { AggregateType } from "../event-sourcing/domain/aggregateType";
import { RETENTION_CATEGORIES, type RetentionCategory } from "./retentionPolicy.schema";

export type EventLogRetentionClass = RetentionCategory | "indefinite";

/**
 * Security event-type prefixes that must remain durable even if an old or
 * malformed row carries an unexpected aggregate type. Aggregate
 * classification remains the normal path; these prefixes are the safety net
 * for identity and authorisation history.
 */
const INDEFINITE_EVENT_TYPE_PREFIXES = ["lw.identity.", "lw.authz."] as const;

/** Security events that share an aggregate with policy-bound operational events. */
const INDEFINITE_EVENT_TYPES = ["lw.governance.vk_lifecycle"] as const;

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
  test_aggregate: "traces",
} as const satisfies Record<AggregateType, EventLogRetentionClass>;

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

  return RETENTION_CLASS_BY_AGGREGATE_TYPE[row.AggregateType as AggregateType];
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

const indefiniteEventTypesSql = aggregateTypeListSql([...INDEFINITE_EVENT_TYPES]);

const indefiniteAggregateTypesSql = aggregateTypeListSql(aggregateTypesFor("indefinite"));

/** Exact ClickHouse predicate for rows that must never expire. */
export const EVENT_LOG_INDEFINITE_RETENTION_SQL_PREDICATE =
  `(${eventTypePrefixSql} OR ` +
  `EventType IN (${indefiniteEventTypesSql}) OR ` +
  `AggregateType IN (${indefiniteAggregateTypesSql}))`;

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

const EVENT_LOG_MUTATION_CATEGORY_MARKER_PREFIX = "langwatch:event-log-retention-category:";

export function eventLogRetentionCategoryMutationMarkerSql(category: RetentionCategory): string {
  const marker = `${EVENT_LOG_MUTATION_CATEGORY_MARKER_PREFIX}${category}`;
  return `length(${sqlStringLiteral(marker)}) > 0`;
}

export function eventLogRetentionCategoryFromMutationCommand(
  command: string | null | undefined,
): RetentionCategory | null {
  if (!command) return null;

  const matchingCategories = RETENTION_CATEGORIES.filter((category) => {
    const marker = `${EVENT_LOG_MUTATION_CATEGORY_MARKER_PREFIX}${category}`;
    return command.includes(sqlStringLiteral(marker));
  });

  return matchingCategories.length === 1 ? matchingCategories[0]! : null;
}
