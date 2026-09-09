import { z } from "zod";
import { canonicalMetricDataPointSchema } from "./metric-data-point.ts";

export const recordMetricDataPointCommandDataSchema = canonicalMetricDataPointSchema;
export type RecordMetricDataPointCommandData = z.infer<
  typeof recordMetricDataPointCommandDataSchema
>;
