/**
 * Domain types for simulation suite configurations.
 *
 * These types represent core business concepts and are used by
 * both the service layer and API layer.
 */

import { z } from "zod";

/** Target reference in a suite configuration */
export const suiteTargetSchema = z.object({
  type: z.enum(["prompt", "http", "code"]),
  referenceId: z.string(),
});

export type SuiteTarget = z.infer<typeof suiteTargetSchema>;

/** Agent types that are valid suite targets (all suite target types except "prompt"). */
export const suiteAgentTargetTypes = new Set(
  suiteTargetSchema.shape.type.options.filter((t: string) => t !== "prompt"),
);

/** Parse and validate suite targets from Prisma's Json field */
export function parseSuiteTargets(raw: unknown): SuiteTarget[] {
  return z.array(suiteTargetSchema).parse(raw);
}
