import { z } from "zod";

import { governanceEventEnvelopeSchema } from "../../governance.ts";

/** Q82 (Alex, 2026-10-06): whether an organization's coding-assistant source is billed. */
export const CODING_ASSISTANT_BILLING_PIPELINE_NAME = "coding_assistant_billing" as const;
export const CODING_ASSISTANT_BILLING_AGGREGATE_TYPE = "coding_assistant_billing" as const;
export const CODING_ASSISTANT_BILLING_EVENT_TYPES = {
  RECORDED: "lw.obs.coding_assistant_billing.recorded",
} as const;
export const CODING_ASSISTANT_BILLING_EVENT_VERSIONS = {
  RECORDED: "2026-10-06",
} as const;

export const codingAssistantBillingRecordedEventDataSchema = z
  .object({
    organizationId: z.string().min(1),
    /** The ingestion source type an assistant kind bills under (`claude_code`, `codex`). */
    sourceType: z.string().min(1),
    /** True only while an enabled config of this kind is not on a bundled plan. */
    billed: z.boolean(),
    /** When governance read the configs; a reader keeps the latest per source. */
    recordedAtMs: z.number().int().positive(),
  })
  .strict();
export type CodingAssistantBillingRecordedEventData = z.infer<
  typeof codingAssistantBillingRecordedEventDataSchema
>;

export const codingAssistantBillingRecordedEventSchema = governanceEventEnvelopeSchema.safeExtend({
  aggregateType: z.literal(CODING_ASSISTANT_BILLING_AGGREGATE_TYPE),
  type: z.literal(CODING_ASSISTANT_BILLING_EVENT_TYPES.RECORDED),
  version: z.literal(CODING_ASSISTANT_BILLING_EVENT_VERSIONS.RECORDED),
  data: codingAssistantBillingRecordedEventDataSchema,
});
export type CodingAssistantBillingRecordedEvent = z.infer<
  typeof codingAssistantBillingRecordedEventSchema
>;

export function codingAssistantBillingAggregateId(data: {
  organizationId: string;
  sourceType: string;
}): string {
  return `${data.organizationId}:${data.sourceType}`;
}
