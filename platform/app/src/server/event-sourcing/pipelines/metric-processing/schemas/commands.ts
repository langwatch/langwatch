import { canonicalMetricDataPointSchema } from "./metricDataPoint";

export const recordMetricDataPointCommandDataSchema =
  canonicalMetricDataPointSchema;
export type RecordMetricDataPointCommandData = ReturnType<
  typeof recordMetricDataPointCommandDataSchema.parse
>;
