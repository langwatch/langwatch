import { z } from "zod";

/** Portable envelope for Trace's durable raw ingress fact. */
export const traceIngressEventEnvelopeSchema = z.object({
  id: z.string(),
  aggregateId: z.string(),
  aggregateType: z.string().trim().min(1),
  tenantId: z
    .string()
    .trim()
    .min(1, "[SECURITY] TenantId must be a non-empty string for tenant isolation")
    .brand<"TenantId">(),
  createdAt: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
  type: z.string().trim().min(1),
  version: z.string().date(),
  data: z.unknown(),
  metadata: z.object({ processingTraceparent: z.string().optional() }).passthrough().optional(),
  idempotencyKey: z.string().optional(),
});
