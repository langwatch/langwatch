import { z } from "zod";

/**
 * The field-level contract for a metric exemplar correlation, shared by the
 * command that validates ingress and the event that is replayed from storage.
 * Both must enforce it: a persisted event is re-validated on replay, so a
 * looser event schema would let a malformed row back into the folds long after
 * the command that rejected its shape.
 */
export const metricCorrelationFields = {
  traceId: z.string().regex(/^[a-f0-9]{32}$/i),
  spanId: z.string().regex(/^[a-f0-9]{16}$/i),
  pointId: z.string().regex(/^[a-f0-9]{64}$/),
  seriesId: z.string().regex(/^[a-f0-9]{64}$/),
  metricName: z.string(),
  metricUnit: z.string(),
  metricKind: z.enum([
    "gauge",
    "sum",
    "histogram",
    "exponential_histogram",
    "summary",
  ]),
  exemplarValue: z.number().nullable(),
  exemplarTimeUnixMs: z.number().int().nonnegative(),
} as const;
