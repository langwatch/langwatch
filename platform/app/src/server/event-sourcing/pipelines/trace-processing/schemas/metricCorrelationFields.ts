import { z } from "zod";
import { metricKindSchema } from "../../metric-processing/schemas/metricDataPoint";

/**
 * The field-level contract for a metric exemplar correlation, shared by the
 * command that validates ingress and the event that is replayed from storage.
 * Both must enforce it: a persisted event is re-validated on replay, so a
 * looser event schema would let a malformed row back into the folds long after
 * the command that rejected its shape.
 *
 * metricKind is imported rather than re-listed for the same reason: a kind
 * added to the canonical schema but not here would make correlation events
 * that the command accepted fail re-validation on replay.
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
