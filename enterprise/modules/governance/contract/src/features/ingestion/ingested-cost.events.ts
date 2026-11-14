import type { Named } from "@langwatch/module";
import { z } from "zod";

import { governanceEventEnvelopeSchema } from "../../governance.ts";

export const INGESTED_COST_PIPELINE_NAME = "ingested_cost_processing" as const;
export const INGESTED_COST_AGGREGATE_TYPE = "ingested_cost" as const;
export const INGESTED_COST_EVENT_TYPES = {
  /** One cost a push source reported for one request; gateway's budget ledger debits it. */
  RECORDED: "lw.obs.ingested_cost.recorded",
} as const;
export const INGESTED_COST_PROCESSING_EVENT_TYPES = Object.values(INGESTED_COST_EVENT_TYPES);
export const INGESTED_COST_EVENT_VERSIONS = {
  RECORDED: "2026-11-14",
} as const;

/**
 * A push source's cost for one request, as the receiver read it: after the source's OTTL rules
 * and with the principal already resolved, so the log holds a member id and never an email.
 */
const ingestedCostRecordedEventDataSchemaDefinition = z
  .object({
    ingestionSourceId: z.string().min(1),
    sourceType: z.string().min(1),
    organizationId: z.string().min(1),
    teamId: z.string().nullable(),
    projectId: z.string().min(1),
    requestId: z.string().min(1),
    model: z.string(),
    tokensInput: z.number().int().nonnegative(),
    tokensOutput: z.number().int().nonnegative(),
    tokensCacheRead: z.number().int().nonnegative(),
    tokensCacheWrite: z.number().int().nonnegative(),
    amountNanoUsd: z.number().int().refine(Number.isSafeInteger),
    principalUserId: z.string().min(1).nullable(),
    occurredAtMs: z.number().int().positive(),
    observedAtMs: z.number().int().positive(),
  })
  .strict();
export interface IngestedCostRecordedEventDataSchema extends Named<
  typeof ingestedCostRecordedEventDataSchemaDefinition
> {}
export const ingestedCostRecordedEventDataSchema: IngestedCostRecordedEventDataSchema =
  ingestedCostRecordedEventDataSchemaDefinition;

const ingestedCostRecordedEventSchemaDefinition = governanceEventEnvelopeSchema.safeExtend({
  aggregateType: z.literal(INGESTED_COST_AGGREGATE_TYPE),
  type: z.literal(INGESTED_COST_EVENT_TYPES.RECORDED),
  version: z.literal(INGESTED_COST_EVENT_VERSIONS.RECORDED),
  data: ingestedCostRecordedEventDataSchema,
});
export interface IngestedCostRecordedEventSchema extends Named<
  typeof ingestedCostRecordedEventSchemaDefinition
> {}
export const ingestedCostRecordedEventSchema: IngestedCostRecordedEventSchema =
  ingestedCostRecordedEventSchemaDefinition;

export type IngestedCostRecordedEventData = z.infer<typeof ingestedCostRecordedEventDataSchema>;
export type IngestedCostRecordedEvent = z.infer<typeof ingestedCostRecordedEventSchema>;
