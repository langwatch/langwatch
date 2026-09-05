/**
 * A trace mapping nobody narrowed. The registry that decides which sources a mapping may
 * name moved into a BROWSER package with the trace UI, and no server module may
 * value-import one.
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
