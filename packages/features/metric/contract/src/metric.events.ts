import { z } from "zod";
import { METRIC_DATA_POINT_RECEIVED_EVENT_TYPE } from "./schemas/metric-processing/constants";
import { canonicalMetricDataPointSchema } from "./schemas/metric-processing/metric-data-point";

/** Portable envelope for a canonical metric event. */
export const metricEventEnvelopeSchema = z.object({
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

export const metricDataPointReceivedEventSchema = metricEventEnvelopeSchema.extend({
  type: z.literal(METRIC_DATA_POINT_RECEIVED_EVENT_TYPE),
  data: canonicalMetricDataPointSchema,
});

export type MetricDataPointReceivedEvent = z.infer<typeof metricDataPointReceivedEventSchema>;
export type MetricProcessingEvent = MetricDataPointReceivedEvent;
