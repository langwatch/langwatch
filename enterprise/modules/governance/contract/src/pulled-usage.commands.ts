import { z } from "zod";

import {
  type PulledUsageRetractedEventData,
  pulledUsageObservedEventDataSchema,
} from "./pulled-usage.events.ts";

export const PULLED_USAGE_COMMAND_TYPES = {
  RECORD: "lw.obs.pulled_usage.record",
  RETRACT: "lw.obs.pulled_usage.retract",
} as const;
export const PULLED_USAGE_PROCESSING_COMMAND_TYPES = Object.values(PULLED_USAGE_COMMAND_TYPES);

export const recordPulledUsageCommandSchema = z
  .object({
    tenantId: z.string().min(1),
    occurredAt: z.number().int().nonnegative().optional(),
    data: pulledUsageObservedEventDataSchema,
  })
  .strict();
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
