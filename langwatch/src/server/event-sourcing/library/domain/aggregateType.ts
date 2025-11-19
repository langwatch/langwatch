import { z } from "zod";

/**
 * Zod schema for aggregate type identifiers.
 */
export const AggregateTypeSchema = z.enum(["span", "trace_aggregation"]);

/**
 * Strongly-typed aggregate type identifiers.
 *
 * Aggregate types represent the type of aggregate root (e.g., "trace", "user"),
 * NOT the event type (e.g., "lw.obs.span.ingestion.recorded").
 *
 * Events are partitioned in the database by tenantId + aggregateType.
 */
export type AggregateType = z.infer<typeof AggregateTypeSchema>;
