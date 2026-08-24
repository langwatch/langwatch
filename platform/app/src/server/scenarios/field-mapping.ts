import { z } from "zod/v4";

/**
 * How one agent input is filled: from a scenario source, or from a literal.
 *
 * This lives on its own because it is the ONLY thing outside the scenario
 * child's own code that reaches into `execution/types.ts` — the suite target
 * schema and the optimization-studio DSL both need it, and the latter is
 * frontend-reachable.
 *
 * Keeping it here means `execution/types.ts` describes only the parent/child
 * execution contract, with no external importers, which is what allows that
 * contract to move to the child's own package later. It is deliberately
 * framework-free (zod and nothing else) so either side can import it without
 * dragging a dependency across the boundary.
 */
export const FieldMappingSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("source"),
    sourceId: z.string(),
    path: z.array(z.string()),
  }),
  z.object({ type: z.literal("value"), value: z.string() }),
]);

export type FieldMapping = z.infer<typeof FieldMappingSchema>;
