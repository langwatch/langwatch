/**
 * The input and output shapes the operator feature-flag surface parses.
 *
 * The rules payload composes `featureFlagRulesWriteSchema`, which the
 * feature-flag module owns: write-time only, because the read path must keep
 * accepting whatever is already stored.
 */
import { featureFlagRulesWriteSchema } from "@langwatch/feature-flag-contract";
import { z } from "zod";

/** The acknowledgement each operator feature-flag write returns. */
export const opsOkOutputSchema = z.object({ ok: z.literal(true) }).strict();

export const opsFeatureFlagKeyInputSchema = z.object({ key: z.string().min(1).max(200) });

export const opsSetFeatureFlagInputSchema = z.object({
  key: z.string().min(1).max(200),
  enabled: z.boolean(),
});

/**
 * A rules write. The refinements catch a rule that cannot match anything and
 * therefore silently does nothing: a blank or padded id, and a
 * new-organizations date that cannot be read.
 */
export const opsSetFeatureFlagRulesInputSchema = z.object({
  ...opsFeatureFlagKeyInputSchema.shape,
  rules: featureFlagRulesWriteSchema,
});
export type OpsSetFeatureFlagRulesInput = z.infer<typeof opsSetFeatureFlagRulesInputSchema>;
