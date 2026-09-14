import { z } from "zod";

const metricKindSchema = z.enum(["gauge", "sum", "histogram", "exponential_histogram", "summary"]);

/**
 * Metric exemplar correlation fields shared by ingress validation and storage
 * replay. Both enforce to prevent malformed rows; metricKind imported to prevent drift.
 */
export const metricCorrelationFields = {
  traceId: z.string().regex(/^[a-f0-9]{32}$/i),
  spanId: z.string().regex(/^[a-f0-9]{16}$/i),
  pointId: z.string().regex(/^[a-f0-9]{64}$/),
  seriesId: z.string().regex(/^[a-f0-9]{64}$/),
  metricName: z.string(),
  metricUnit: z.string(),
  metricKind: metricKindSchema,
  exemplarValue: z.number().nullable(),
  exemplarTimeUnixMs: z.number().int().nonnegative(),
} as const;
