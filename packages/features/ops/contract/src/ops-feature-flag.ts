/**
 * The input and output shapes the operator feature-flag surface parses.
 *
 * The rules payload is not here: its write-time refinement composes
 * `featureFlagRulesSchema`, which the feature-flag feature owns, and this
 * package does not depend on it. That one schema stays at the transport.
 */
import { z } from "zod";

/** The acknowledgement each operator feature-flag write returns. */
export const opsOkOutputSchema = z.object({ ok: z.literal(true) }).strict();

export const opsFeatureFlagKeyInputSchema = z.object({ key: z.string().min(1).max(200) });

export const opsSetFeatureFlagInputSchema = z.object({
  key: z.string().min(1).max(200),
  enabled: z.boolean(),
});
