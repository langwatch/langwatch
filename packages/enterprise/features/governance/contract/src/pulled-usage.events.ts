import { z } from "zod";
import { governanceEventEnvelopeSchema } from "./governance";

export const PULLED_USAGE_PIPELINE_NAME = "pulled_usage_processing" as const;
export const PULLED_USAGE_AGGREGATE_TYPE = "pulled_usage" as const;
export const PULLED_USAGE_EVENT_TYPES = {
  OBSERVED: "lw.obs.pulled_usage.observed",
} as const;
export const PULLED_USAGE_PROCESSING_EVENT_TYPES = Object.values(PULLED_USAGE_EVENT_TYPES);
export const PULLED_USAGE_EVENT_VERSIONS = { OBSERVED: "2026-08-06" } as const;
export const PULLED_USAGE_COST_BASIS = {
  PROVIDER_REPORTED: "provider_reported",
  COMPUTED: "computed",
} as const;
export const PULLED_USAGE_COST_STATUS = {
  EXACT: "exact",
  ESTIMATE: "estimate",
} as const;
export const pulledUsageCostBasisSchema = z.enum(PULLED_USAGE_COST_BASIS);
export const pulledUsageCostStatusSchema = z.enum(PULLED_USAGE_COST_STATUS);

export const pulledUsageObservedEventDataSchema = z
  .object({
    itemKey: z.string().min(1),
    restatementKey: z.string().min(1),
    source: z.string().min(1),
    ingestionSourceId: z.string().min(1),
    organizationId: z.string().min(1),
    teamId: z.string().nullable(),
    projectId: z.string().nullable(),
    model: z.string(),
    tokensInput: z.number().int().nonnegative(),
    tokensOutput: z.number().int().nonnegative(),
    tokensCacheRead: z.number().int().nonnegative(),
    tokensCacheWrite: z.number().int().nonnegative(),
    costNanoUsd: z.number().int().nonnegative(),
    rateVersion: z.string().nullable(),
    costBasis: pulledUsageCostBasisSchema,
    costStatus: pulledUsageCostStatusSchema,
    occurredAtMs: z.number().int().positive(),
    observedAtMs: z.number().int().positive(),
  })
  .strict();

export const pulledUsageObservedEventSchema = governanceEventEnvelopeSchema.extend({
  aggregateType: z.literal(PULLED_USAGE_AGGREGATE_TYPE),
  type: z.literal(PULLED_USAGE_EVENT_TYPES.OBSERVED),
  version: z.literal(PULLED_USAGE_EVENT_VERSIONS.OBSERVED),
  data: pulledUsageObservedEventDataSchema,
});

export type PulledUsageCostBasis = z.infer<typeof pulledUsageCostBasisSchema>;
export type PulledUsageCostStatus = z.infer<typeof pulledUsageCostStatusSchema>;
export type PulledUsageObservedEventData = z.infer<typeof pulledUsageObservedEventDataSchema>;
export type PulledUsageObservedEvent = z.infer<typeof pulledUsageObservedEventSchema>;
