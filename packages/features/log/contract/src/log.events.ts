import { z } from "zod";
import { CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE } from "./log.constants";
import { canonicalLogRecordSchema } from "./log-record";

export const logEventEnvelopeSchema = z.object({
  id: z.string(),
  aggregateId: z.string(),
  aggregateType: z.string().trim().min(1),
  tenantId: z.string().trim().min(1).brand<"TenantId">(),
  createdAt: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
  type: z.string().trim().min(1),
  version: z.string().date(),
  data: z.unknown(),
  metadata: z.object({ processingTraceparent: z.string().optional() }).passthrough().optional(),
  idempotencyKey: z.string().optional(),
});

export const canonicalLogRecordReceivedEventSchema = logEventEnvelopeSchema.extend({
  type: z.literal(CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE),
  data: canonicalLogRecordSchema,
});

export type CanonicalLogRecordReceivedEvent = z.infer<typeof canonicalLogRecordReceivedEventSchema>;
export type LogProcessingEvent = CanonicalLogRecordReceivedEvent;
