import { z } from "zod";
import { AGGREGATE_TYPE_IDENTIFIERS } from "../../schemas/typeIdentifiers";

/**
 * Aggregate type identifiers follow the taxonomy system defined in ./taxonomy.ts.
 * They are the third segment in the taxonomy hierarchy: `<provenance>.<domain>.<aggregate-type>.<identifier>`
 *
 * Example: In "lw.obs.span_ingestion.recorded", the aggregate type is "span_ingestion".
 */

export const AggregateTypeSpanIngestionSchema = z.literal("span_ingestion");
export type AggregateTypeSpanIngestion = z.infer<
  typeof AggregateTypeSpanIngestionSchema
>;

export const AggregateTypeTraceAggregationSchema =
  z.literal("trace_aggregation");
export type AggregateTypeTraceAggregation = z.infer<
  typeof AggregateTypeTraceAggregationSchema
>;

/**
 * Zod schema for aggregate type identifiers.
 * Built from type arrays defined in schemas.
 */
export const AggregateTypeSchema = z.enum(AGGREGATE_TYPE_IDENTIFIERS);

/**
 * Strongly-typed aggregate type identifiers.
 *
 * Aggregate types represent the type of aggregate root (e.g., "span_ingestion", "trace_aggregation"),
 * NOT the event type (e.g., "lw.obs.span_ingestion.recorded").
 *
 * Aggregate types are part of the taxonomy system (see ./taxonomy.ts) and are the third segment
 * in the taxonomy hierarchy: `<provenance>.<domain>.<aggregate-type>.<identifier>`
 *
 * Events are partitioned in the database by tenantId + aggregateType.
 *
 * This type is inferred from the zod schema, which is built from type arrays
 * defined in schemas. Schemas are the single source of truth for type identifiers.
 */
export type AggregateType = z.infer<typeof AggregateTypeSchema>;
