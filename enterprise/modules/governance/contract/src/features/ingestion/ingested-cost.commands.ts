import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  type IngestedCostRecordedEventData,
  ingestedCostRecordedEventDataSchema,
} from "./ingested-cost.events.ts";

export const INGESTED_COST_COMMAND_TYPES = {
  RECORD: "lw.obs.ingested_cost.record",
} as const;
export const INGESTED_COST_PROCESSING_COMMAND_TYPES = Object.values(INGESTED_COST_COMMAND_TYPES);

const recordIngestedCostCommandSchemaDefinition = z
  .object({
    tenantId: z.string().min(1),
    occurredAt: z.number().int().nonnegative().optional(),
    data: ingestedCostRecordedEventDataSchema,
  })
  .strict();
export interface RecordIngestedCostCommandSchema extends Named<
  typeof recordIngestedCostCommandSchemaDefinition
> {}
export const recordIngestedCostCommandSchema: RecordIngestedCostCommandSchema =
  recordIngestedCostCommandSchemaDefinition;
export type RecordIngestedCostCommand = z.infer<typeof recordIngestedCostCommandSchema>;

/** One fact per source and request: an exporter's resend of a batch records nothing twice. */
export function ingestedCostKey(
  data: Pick<IngestedCostRecordedEventData, "ingestionSourceId" | "requestId">,
): string {
  return `${data.ingestionSourceId}:${data.requestId}`;
}
