/**
 * Domain types for simulation suite configurations.
 *
 * These types represent core business concepts and are used by
 * both the service layer and API layer.
 */

import { z } from "zod";

/** Target reference in a suite configuration */
export const suiteTargetSchema = z.object({
  type: z.enum(["prompt", "http"]),
  referenceId: z.string(),
});

export type SuiteTarget = z.infer<typeof suiteTargetSchema>;

/** Parse and validate suite targets from Prisma's Json field */
export function parseSuiteTargets(raw: unknown): SuiteTarget[] {
  return z.array(suiteTargetSchema).parse(raw);
}
