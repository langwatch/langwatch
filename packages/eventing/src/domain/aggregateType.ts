import { z } from "zod";

/**
 * Aggregate type identifiers follow a taxonomy system.
 * They are the third segment in the taxonomy hierarchy: `<provenance>.<domain>.<aggregate-type>.<identifier>`
 *
 * Example: In "lw.obs.trace.span_received", the aggregate type is "trace".
 */

export const AggregateTypeSchema = z.string().trim().min(1);

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
 * Applications own their finite aggregate catalogue; the framework owns only
 * the validated wire shape.
 */
export type AggregateType = z.infer<typeof AggregateTypeSchema>;
