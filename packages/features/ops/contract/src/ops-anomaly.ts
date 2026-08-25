import { z } from "zod";

export const anomalyKindSchema = z.literal("rate_breaker");
export const anomalyTierSchema = z.enum(["surface", "hard"]);

export const anomalySchema = z
  .object({
    tenantId: z.string().min(1),
    kind: anomalyKindSchema,
    tier: anomalyTierSchema,
    currentRate: z.number().finite(),
    baseline: z.number().finite(),
    triggeredAt: z.number().finite(),
    contributors: z.record(z.string(), z.number().finite()).optional(),
    reason: z.string(),
  })
  .strict();

export type Anomaly = z.infer<typeof anomalySchema>;
export type AnomalyKind = z.infer<typeof anomalyKindSchema>;
export type AnomalyTier = z.infer<typeof anomalyTierSchema>;
