import { z } from "zod";
import { canonicalMetricDataPointSchema } from "./metric-data-point";

export const recordMetricDataPointCommandDataSchema = canonicalMetricDataPointSchema;
export type RecordMetricDataPointCommandData = z.infer<
  typeof recordMetricDataPointCommandDataSchema
>;
