import { retentionCategories, type RetentionCategory } from "@langwatch/data-retention-contract";
/**
 * ClickHouse SQL for `event_log`'s per-row retention classification. Derived
 * from the same exhaustive aggregate map ingestion stamps rows with, so a
 * retroactive category change can never overwrite an indefinite security row.
 */
import {
  INDEFINITE_EVENT_TYPE_PREFIXES,
  INDEFINITE_EVENT_TYPES,
  RETENTION_CLASS_BY_AGGREGATE_TYPE,
  type EventLogRetentionClass,
} from "@langwatch/data-retention-contract/event-log-retention-policy";

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
 * Finite-policy predicate for one retention category, generated from the same
 * map as ingestion — traces excludes scenario/experiment aggregate types so
 * neither can silently inherit the traces retention window.
 */
export function eventLogRetentionCategorySqlPredicate(category: RetentionCategory): string {
  const finiteGuard = `NOT ${EVENT_LOG_INDEFINITE_RETENTION_SQL_PREDICATE}`;

  if (category === "traces") {
    const otherFiniteAggregateTypes = [
      ...aggregateTypesFor("scenarios"),
      ...aggregateTypesFor("experiments"),
    ].toSorted();
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

/**
 * No-op predicate fragment stamping which category triggered a mutation, so a
 * concurrent mutation for a different category is distinguishable from a real
 * conflict.
 */
export function eventLogRetentionCategoryMutationMarkerSql(category: RetentionCategory): string {
  const marker = `${EVENT_LOG_MUTATION_CATEGORY_MARKER_PREFIX}${category}`;
  return `length(${sqlStringLiteral(marker)}) > 0`;
}

/** Recovers the marker {@link eventLogRetentionCategoryMutationMarkerSql} stamped, if any. */
export function extractEventLogRetentionCategoryFromMutationCommand(
  command: string | null | undefined,
): RetentionCategory | null {
  if (!command) return null;

  const matchingCategories = retentionCategories.filter((category) => {
    const marker = `${EVENT_LOG_MUTATION_CATEGORY_MARKER_PREFIX}${category}`;
    return command.includes(sqlStringLiteral(marker));
  });

  return matchingCategories.length === 1 ? matchingCategories[0]! : null;
}
