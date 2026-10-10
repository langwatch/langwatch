import { z } from "zod";

/**
 * Aggregate type: third segment in taxonomy `<provenance>.<domain>.<aggregate-type>`.
 * Example: "trace" in "lw.obs.trace.span_received".
 */

export const AggregateTypeSchema = z.string().trim().min(1);

/**
 * Strongly-typed aggregate type identifiers (e.g., "trace").
 * Events are partitioned by tenantId + aggregateType in the database.
 */
export type AggregateType = z.infer<typeof AggregateTypeSchema>;
