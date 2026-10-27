import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  type PulledUsagePricedEventData,
  type PulledUsageRetractedEventData,
  pulledUsageObservedEventDataSchema,
} from "./pulled-usage.events.ts";

export const PULLED_USAGE_COMMAND_TYPES = {
  RECORD: "lw.obs.pulled_usage.record",
  RETRACT: "lw.obs.pulled_usage.retract",
  PRICE: "lw.obs.pulled_usage.price",
} as const;
export const PULLED_USAGE_PROCESSING_COMMAND_TYPES = Object.values(PULLED_USAGE_COMMAND_TYPES);

const recordPulledUsageCommandSchemaDefinition = z
  .object({
    tenantId: z.string().min(1),
    occurredAt: z.number().int().nonnegative().optional(),
    data: pulledUsageObservedEventDataSchema,
  })
  .strict();
export interface RecordPulledUsageCommandSchema extends Named<
  typeof recordPulledUsageCommandSchemaDefinition
> {}
export const recordPulledUsageCommandSchema: RecordPulledUsageCommandSchema =
  recordPulledUsageCommandSchemaDefinition;
export type RecordPulledUsageCommand = z.infer<typeof recordPulledUsageCommandSchema>;
export type PulledUsageProcessingCommandType =
  (typeof PULLED_USAGE_PROCESSING_COMMAND_TYPES)[number];

export function pulledUsageObservationKey(
  data: z.infer<typeof pulledUsageObservedEventDataSchema>,
): string {
  return [
    data.restatementKey,
    data.costNanoMinor,
    // Both, and both matter. A provider that re-denominates a period or lands
    // its dollar conversion later has changed the record without changing the
    // native amount, and a key blind to either would dedup that correction
    // away as an unchanged re-pull.
    data.currencyCode,
    data.costNanoUsd,
    data.tokensInput,
    data.tokensOutput,
    data.tokensCacheRead,
    data.tokensCacheWrite,
    data.costBasis,
    data.costStatus,
    data.observedAtMs,
  ].join(":");
}

/** One withdrawal per superseded cell and superseding pull; a redelivery sends the same key. */
export function pulledUsageRetractionKey(data: PulledUsageRetractedEventData): string {
  return [
    "retract",
    data.restatementKey,
    data.currencyCode,
    data.agentId,
    data.rawActorId,
    data.model,
    data.observedAtMs,
  ].join(":");
}

/** One priced fact per observation of a restatement key; a redelivered intent appends nothing. */
export function pulledUsagePricedKey(data: PulledUsagePricedEventData): string {
  return ["priced", data.restatementKey, data.observedAtMs].join(":");
}
