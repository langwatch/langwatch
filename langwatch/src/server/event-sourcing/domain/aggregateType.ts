import { z } from "zod";
import { AGGREGATE_TYPE_IDENTIFIERS } from "../schemas/typeIdentifiers";

/**
 * Aggregate type identifiers follow a taxonomy system.
 * They are the third segment in the taxonomy hierarchy: `<provenance>.<domain>.<aggregate-type>.<identifier>`
 *
 * Example: In "lw.obs.trace.span_received", the aggregate type is "trace".
 */

export const AggregateTypeTraceSchema = z.literal("trace");
export type AggregateTypeTrace = z.infer<typeof AggregateTypeTraceSchema>;

/**
 * Zod schema for aggregate type identifiers.
 * Built from type arrays defined in schemas.
 */
export const AggregateTypeSchema = z.enum(AGGREGATE_TYPE_IDENTIFIERS);

/**
 * Strongly-typed aggregate type identifiers.
 *
 * Aggregate types represent the type of aggregate root (e.g., "trace"),
 * NOT the event type (e.g., "lw.obs.trace.span_received").
 *
 * Aggregate types are part of the taxonomy system and are the third segment
 * in the taxonomy hierarchy: `<provenance>.<domain>.<aggregate-type>.<identifier>`
 *
 * Events are partitioned in the database by tenantId + aggregateType.
 *
 * This type is inferred from the zod schema, which is built from type arrays
 * defined in schemas. Schemas are the single source of truth for type identifiers.
 */
export type AggregateType = z.infer<typeof AggregateTypeSchema>;
