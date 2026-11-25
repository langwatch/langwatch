import type { Named } from "@langwatch/module";
import { z } from "zod";

export const anomalyKindSchema = z.literal("rate_breaker");
export const anomalyTierSchema = z.enum(["surface", "hard"]);

const anomalySchemaDefinition = z
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
export interface AnomalySchema extends Named<typeof anomalySchemaDefinition> {}
export const anomalySchema: AnomalySchema = anomalySchemaDefinition;

export type Anomaly = z.infer<typeof anomalySchema>;
export type AnomalyKind = z.infer<typeof anomalyKindSchema>;
export type AnomalyTier = z.infer<typeof anomalyTierSchema>;

/**
 * The operator's manual dismissal of one active anomaly. `kind` stays a
 * one-member enum rather than reusing `anomalyKindSchema`: they accept the
 * same value, but a literal and an enum word rejection differently.
 */
const opsDismissAnomalyInputSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  kind: z.enum(["rate_breaker"]),
});
export interface OpsDismissAnomalyInputSchema extends Named<
  typeof opsDismissAnomalyInputSchemaDefinition
> {}
export const opsDismissAnomalyInputSchema: OpsDismissAnomalyInputSchema =
  opsDismissAnomalyInputSchemaDefinition;
