import { z } from "zod";
import { CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE } from "./constants";
import { canonicalLogRecordSchema } from "./log-record";
import { telemetryEventEnvelopeSchema } from "../../telemetry.events";

export const canonicalLogRecordReceivedEventSchema = telemetryEventEnvelopeSchema.extend({
  type: z.literal(CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE),
  data: canonicalLogRecordSchema,
});

export type CanonicalLogRecordReceivedEvent = z.infer<
  typeof canonicalLogRecordReceivedEventSchema
>;

export type LogProcessingEvent = CanonicalLogRecordReceivedEvent;
