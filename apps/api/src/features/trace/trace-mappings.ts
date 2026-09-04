/**
 * A trace mapping nobody narrowed.
 *
 * The registry that decides which sources a mapping may name moved into a
 * BROWSER package with the trace UI, and no server module may value-import
 * one. So these parse the SHAPE and not the vocabulary: a mapping travels to
 * the evaluator exactly as the client sent it, which is what the platform app
 * did before the registry existed and is strictly what a permissive parse
 * means. The narrowing returns with the trace vertical.
 *
 * Two surfaces read the same registry — an evaluation's run mappings and a
 * monitor's stored ones — so the stand-in is stated once here rather than
 * twice, where they could drift into admitting different mappings.
 */
import { z } from "zod";

/** The shape a run's field mappings have, with no vocabulary attached. */
export const permissiveMappingsSchema = z
  .object({
    mapping: z.record(z.string(), z.unknown()).default({}),
    expansions: z.array(z.string()).default([]),
  })
  .passthrough()
  .nullable();

/** The same shape, coerced rather than parsed, for a stored monitor row. */
export const permissiveCoerceMonitorMappings = (mappings: unknown): unknown => {
  if (typeof mappings !== "object" || mappings === null || Array.isArray(mappings)) {
    return { mapping: {}, expansions: [] };
  }
  if (!("mapping" in mappings)) return { mapping: {}, expansions: [] };
  const parsed = permissiveMappingsSchema.safeParse(mappings);
  return parsed.success && parsed.data ? parsed.data : { mapping: {}, expansions: [] };
};
