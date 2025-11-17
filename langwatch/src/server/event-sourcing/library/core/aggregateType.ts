/**
 * Strongly-typed aggregate type identifiers.
 *
 * Aggregate types represent the type of aggregate root (e.g., "trace", "user"),
 * NOT the event type (e.g., "span.ingestion.ingested").
 *
 * Events are partitioned in the database by tenantId + aggregateType.
 */
export type AggregateType = "trace" | "user" | "evaluation";
