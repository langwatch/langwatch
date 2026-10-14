import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  codingAssistantBillingAggregateId,
  codingAssistantBillingRecordedEventDataSchema,
  type CodingAssistantBillingRecordedEventData,
} from "./coding-assistant-billing.events.ts";

export const CODING_ASSISTANT_BILLING_COMMAND_TYPES = {
  RECORD: "lw.obs.coding_assistant_billing.record",
} as const;

const recordCodingAssistantBillingCommandSchemaDefinition = z
  .object({
    tenantId: z.string().min(1),
    occurredAt: z.number().int().nonnegative().optional(),
    data: codingAssistantBillingRecordedEventDataSchema,
  })
  .strict();
export interface RecordCodingAssistantBillingCommandSchema extends Named<
  typeof recordCodingAssistantBillingCommandSchemaDefinition
> {}
export const recordCodingAssistantBillingCommandSchema: RecordCodingAssistantBillingCommandSchema =
  recordCodingAssistantBillingCommandSchemaDefinition;
export type RecordCodingAssistantBillingCommand = z.infer<
  typeof recordCodingAssistantBillingCommandSchema
>;

export function codingAssistantBillingRecordKey(
  data: CodingAssistantBillingRecordedEventData,
): string {
  return `${codingAssistantBillingAggregateId(data)}:${data.billed}:${data.recordedAtMs}`;
}
