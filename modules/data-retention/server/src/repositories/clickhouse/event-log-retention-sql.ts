/**
 * ClickHouse SQL for the `event_log` table's per-row retention classification
 * (`@langwatch/data-retention-contract/event-log-retention-policy`). Generated
 * from the same exhaustive aggregate map ingestion stamps rows with, so a
 * retroactive category change can never overwrite an indefinite security row
 * or apply the wrong category's retention to a scenario/experiment event.
 */
import {
  INDEFINITE_EVENT_TYPE_PREFIXES,
  INDEFINITE_EVENT_TYPES,
  RETENTION_CLASS_BY_AGGREGATE_TYPE,
  type EventLogRetentionClass,
} from "@langwatch/data-retention-contract/event-log-retention-policy";
import { retentionCategories, type RetentionCategory } from "@langwatch/data-retention-contract";

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
    `${finiteGuard} AND ` + `AggregateType IN (${aggregateTypeListSql(aggregateTypesFor(category))})`
  );
}

const EVENT_LOG_MUTATION_CATEGORY_MARKER_PREFIX = "langwatch:event-log-retention-category:";

/**
 * A no-op predicate fragment that stamps which category triggered an
 * `event_log` mutation, so a concurrent mutation for a different category can
 * be told apart from a real conflict and a resumed process can report
 * progress against the category that started it.
 */
export function eventLogRetentionCategoryMutationMarkerSql(category: RetentionCategory): string {
  const marker = `${EVENT_LOG_MUTATION_CATEGORY_MARKER_PREFIX}${category}`;
  return `length(${sqlStringLiteral(marker)}) > 0`;
}

/** Recovers the marker {@link eventLogRetentionCategoryMutationMarkerSql} stamped, if any. */
export function eventLogRetentionCategoryFromMutationCommand(
  command: string | null | undefined,
): RetentionCategory | null {
  if (!command) return null;

  const matchingCategories = retentionCategories.filter((category) => {
    const marker = `${EVENT_LOG_MUTATION_CATEGORY_MARKER_PREFIX}${category}`;
    return command.includes(sqlStringLiteral(marker));
  });

  return matchingCategories.length === 1 ? matchingCategories[0]! : null;
}
