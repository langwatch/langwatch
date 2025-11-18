/**
 * Strongly-typed aggregate type identifiers.
 *
 * Aggregate types represent the type of aggregate root (e.g., "trace", "user"),
 * NOT the event type (e.g., "lw.obs.span.ingestion.recorded").
 *
 * Events are partitioned in the database by tenantId + aggregateType.
 */
export type AggregateType = "span" | "trace" | "user" | "evaluation";
