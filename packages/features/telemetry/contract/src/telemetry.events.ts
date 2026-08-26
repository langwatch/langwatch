import { z } from "zod";

/**
 * Transport-neutral event envelope shared by Telemetry payload contracts.
 * Eventing adds the same envelope at runtime; keeping this small schema here
 * lets browser-safe contracts describe events without importing its runtime.
 */
export const telemetryEventEnvelopeSchema = z.object({
  id: z.string(),
  aggregateId: z.string(),
  aggregateType: z.string().trim().min(1),
  tenantId: z.string().trim().min(1),
  createdAt: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
  type: z.string().trim().min(1),
  version: z.string().date(),
  data: z.unknown(),
  metadata: z
    .object({ processingTraceparent: z.string().optional() })
    .passthrough()
    .optional(),
  idempotencyKey: z.string().optional(),
});
