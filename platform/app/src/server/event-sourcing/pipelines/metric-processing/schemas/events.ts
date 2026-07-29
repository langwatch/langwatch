import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import {
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
  METRIC_DATA_POINT_RECEIVED_EVENT_VERSION_LATEST,
} from "./constants";
import { canonicalMetricDataPointSchema } from "./metricDataPoint";

export const metricDataPointReceivedEventSchema = EventSchema.extend({
  type: z.literal(METRIC_DATA_POINT_RECEIVED_EVENT_TYPE),
  version: z.literal(METRIC_DATA_POINT_RECEIVED_EVENT_VERSION_LATEST),
  data: canonicalMetricDataPointSchema,
});

export type MetricDataPointReceivedEvent = z.infer<
  typeof metricDataPointReceivedEventSchema
>;

export type MetricProcessingEvent = MetricDataPointReceivedEvent;
