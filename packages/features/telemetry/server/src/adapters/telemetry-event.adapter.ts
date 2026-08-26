import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";
import {
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
  canonicalLogRecordSchema,
  canonicalMetricDataPointSchema,
} from "@langwatch/telemetry-contract";

export const canonicalLogRecordReceivedEventSchema = EventSchema.extend({
  type: z.literal(CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE),
  data: canonicalLogRecordSchema,
});
export type CanonicalLogRecordReceivedEvent = z.infer<
  typeof canonicalLogRecordReceivedEventSchema
>;
export type LogProcessingEvent = CanonicalLogRecordReceivedEvent;

export const metricDataPointReceivedEventSchema = EventSchema.extend({
  type: z.literal(METRIC_DATA_POINT_RECEIVED_EVENT_TYPE),
  data: canonicalMetricDataPointSchema,
});
export type MetricDataPointReceivedEvent = z.infer<
  typeof metricDataPointReceivedEventSchema
>;
export type MetricProcessingEvent = MetricDataPointReceivedEvent;

export class TelemetryEventAdapter {
  private constructor() {}

  static create(): TelemetryEventAdapter {
    return new TelemetryEventAdapter();
  }
}
