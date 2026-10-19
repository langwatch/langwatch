/**
 * The input and output shapes the operator feature-flag surface parses.
 * The rules payload composes `featureFlagRulesWriteSchema` write-time only
 * - the read path must keep accepting whatever is already stored.
 */
import { featureFlagRulesWriteSchema } from "@langwatch/feature-flag-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The acknowledgement each operator feature-flag write returns. */
const opsOkOutputSchemaDefinition = z.object({ ok: z.literal(true) }).strict();
export interface OpsOkOutputSchema extends Named<typeof opsOkOutputSchemaDefinition> {}
export const opsOkOutputSchema: OpsOkOutputSchema = opsOkOutputSchemaDefinition;

const opsFeatureFlagKeyInputSchemaDefinition = z.object({ key: z.string().min(1).max(200) });
export interface OpsFeatureFlagKeyInputSchema extends Named<
  typeof opsFeatureFlagKeyInputSchemaDefinition
> {}
export const opsFeatureFlagKeyInputSchema: OpsFeatureFlagKeyInputSchema =
  opsFeatureFlagKeyInputSchemaDefinition;

const opsSetFeatureFlagInputSchemaDefinition = z.object({
  key: z.string().min(1).max(200),
  enabled: z.boolean(),
});
export interface OpsSetFeatureFlagInputSchema extends Named<
  typeof opsSetFeatureFlagInputSchemaDefinition
> {}
export const opsSetFeatureFlagInputSchema: OpsSetFeatureFlagInputSchema =
  opsSetFeatureFlagInputSchemaDefinition;

/**
 * A rules write. The refinements catch a rule that cannot match anything and
 * therefore silently does nothing: a blank or padded id, and a
 * new-organizations date that cannot be read.
 */
const opsSetFeatureFlagRulesInputSchemaDefinition = z.object({
  ...opsFeatureFlagKeyInputSchema.shape,
  rules: featureFlagRulesWriteSchema,
});
export interface OpsSetFeatureFlagRulesInputSchema extends Named<
  typeof opsSetFeatureFlagRulesInputSchemaDefinition
> {}
export const opsSetFeatureFlagRulesInputSchema: OpsSetFeatureFlagRulesInputSchema =
  opsSetFeatureFlagRulesInputSchemaDefinition;
export type OpsSetFeatureFlagRulesInput = z.infer<typeof opsSetFeatureFlagRulesInputSchema>;
