import { z } from "zod";
import { pulledUsageObservedEventDataSchema } from "./pulled-usage.events";

export const PULLED_USAGE_COMMAND_TYPES = {
  RECORD: "lw.obs.pulled_usage.record",
} as const;
export const PULLED_USAGE_PROCESSING_COMMAND_TYPES = Object.values(
  PULLED_USAGE_COMMAND_TYPES,
);

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
