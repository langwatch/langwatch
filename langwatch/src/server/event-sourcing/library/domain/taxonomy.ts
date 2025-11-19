import { z } from "zod";

export const ProvenanceLangWatchSchema = z.literal("lw");
export type ProvenanceLangWatch = z.infer<typeof ProvenanceLangWatchSchema>;
export type Provenance = ProvenanceLangWatch;

export const DomainObservabilitySchema = z.literal("obs");
export type DomainObservability = z.infer<typeof DomainObservabilitySchema>;
export type Domain = DomainObservability;

export const EntitySpanIngestionSchema = z.literal("span_ingestion");
export type EntitySpanIngestion = z.infer<typeof EntitySpanIngestionSchema>;
export const EntityTraceAggregationSchema = z.literal("trace_aggregation");
export type EntityTraceAggregation = z.infer<
  typeof EntityTraceAggregationSchema
>;
export const EntitySchema = z.union([
  EntitySpanIngestionSchema,
  EntityTraceAggregationSchema,
]);
export type Entity = z.infer<typeof EntitySchema>;

export type LwObsEntitySpanIngestion =
  `${ProvenanceLangWatch}.${DomainObservability}.${EntitySpanIngestion}`;
export type LwObsEntityTraceAggregation =
  `${ProvenanceLangWatch}.${DomainObservability}.${EntityTraceAggregation}`;
