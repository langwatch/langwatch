import { z } from "zod";
import type {
  AggregateTypeSpanIngestion,
  AggregateTypeTraceAggregation,
} from "./aggregateType";

/**
 * Taxonomy system for organizing event sourcing aggregates, commands, and events.
 *
 * The taxonomy follows a hierarchical structure:
 * `<provenance>.<domain>.<aggregate-type>.<specific-identifier>`
 *
 * Example: `lw.obs.span_ingestion.record`
 * - `lw`: Provenance (LangWatch)
 * - `obs`: Domain (Observability)
 * - `span_ingestion`: Aggregate type
 * - `record`: Specific identifier (command/event name)
 *
 * This structure ensures unique, namespaced identifiers across the system.
 */

/**
 * Zod schema for LangWatch provenance identifier.
 * Provenance identifies the source/origin of the aggregate type.
 */
export const ProvenanceLangWatchSchema = z.literal("lw");

/**
 * Type for LangWatch provenance identifier.
 */
export type ProvenanceLangWatch = z.infer<typeof ProvenanceLangWatchSchema>;

/**
 * Union type for all possible provenance identifiers.
 * Currently only supports LangWatch, but can be extended for other sources.
 */
export type Provenance = ProvenanceLangWatch;

/**
 * Zod schema for Observability domain identifier.
 * Domain groups related aggregates by functional area.
 */
export const DomainObservabilitySchema = z.literal("obs");

/**
 * Type for Observability domain identifier.
 */
export type DomainObservability = z.infer<typeof DomainObservabilitySchema>;

/**
 * Union type for all possible domain identifiers.
 * Currently only supports Observability, but can be extended for other domains.
 */
export type Domain = DomainObservability;

/**
 * Template type for span ingestion aggregate types.
 *
 * Format: `lw.obs.span_ingestion.<identifier>`
 *
 * @example
 * ```typescript
 * type RecordCommand = "lw.obs.span_ingestion.record";
 * ```
 */
export type LwObsAggregateTypeSpanIngestion =
  `${ProvenanceLangWatch}.${DomainObservability}.${AggregateTypeSpanIngestion}.${string}`;

/**
 * Template type for trace aggregation aggregate types.
 *
 * Format: `lw.obs.trace_aggregation.<identifier>`
 *
 * @example
 * ```typescript
 * type TriggerCommand = "lw.obs.trace_aggregation.trigger";
 * ```
 */
export type LwObsAggregateTypeTraceAggregation =
  `${ProvenanceLangWatch}.${DomainObservability}.${AggregateTypeTraceAggregation}.${string}`;

/**
 * Union type of all LangWatch Observability aggregate types.
 *
 * This type represents all valid aggregate type identifiers in the
 * LangWatch Observability domain, including span ingestion and trace aggregation.
 */
export type LwObsAggregateType =
  | LwObsAggregateTypeSpanIngestion
  | LwObsAggregateTypeTraceAggregation;
