import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import { METRIC_DATA_POINT_RECEIVED_EVENT_TYPE } from "./constants";
import { canonicalMetricDataPointSchema } from "./metricDataPoint";

export const metricDataPointReceivedEventSchema = EventSchema.extend({
  type: z.literal(METRIC_DATA_POINT_RECEIVED_EVENT_TYPE),
  data: canonicalMetricDataPointSchema,
});

export type MetricDataPointReceivedEvent = z.infer<
  typeof metricDataPointReceivedEventSchema
>;

export type MetricProcessingEvent = MetricDataPointReceivedEvent;
