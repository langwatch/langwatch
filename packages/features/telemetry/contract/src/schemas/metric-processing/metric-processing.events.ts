import { z } from "zod";
import { METRIC_DATA_POINT_RECEIVED_EVENT_TYPE } from "./constants";
import { canonicalMetricDataPointSchema } from "./metric-data-point";
import { telemetryEventEnvelopeSchema } from "../../telemetry.events";

export const metricDataPointReceivedEventSchema = telemetryEventEnvelopeSchema.extend({
  type: z.literal(METRIC_DATA_POINT_RECEIVED_EVENT_TYPE),
  data: canonicalMetricDataPointSchema,
});

export type MetricDataPointReceivedEvent = z.infer<
  typeof metricDataPointReceivedEventSchema
>;

export type MetricProcessingEvent = MetricDataPointReceivedEvent;
