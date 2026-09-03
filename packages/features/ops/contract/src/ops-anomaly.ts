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

/**
 * The operator's manual dismissal of one active anomaly.
 *
 * `kind` stays a one-member enum rather than reusing `anomalyKindSchema`
 * above: the two accept exactly the same value, but a literal and an enum
 * word their rejection differently, and this schema is the live transport
 * contract.
 */
export const opsDismissAnomalyInputSchema = z.object({
  tenantId: z.string().min(1),
  kind: z.enum(["rate_breaker"]),
});
