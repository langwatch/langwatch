import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import {
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
} from "./constants";
import { canonicalLogRecordSchema } from "./logRecord";

export const canonicalLogRecordReceivedEventSchema = EventSchema.extend({
  type: z.literal(CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE),
  version: z.literal(CANONICAL_LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST),
  data: canonicalLogRecordSchema,
});

export type CanonicalLogRecordReceivedEvent = z.infer<
  typeof canonicalLogRecordReceivedEventSchema
>;

export type LogProcessingEvent = CanonicalLogRecordReceivedEvent;
