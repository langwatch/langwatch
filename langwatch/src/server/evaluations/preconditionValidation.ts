import { z } from "zod";
import { PRECONDITION_FIELD_CONFIG } from "./types";
import { checkPreconditionsSchema } from "./types.generated";

/**
 * Refinement callback that cross-validates each precondition's rule
 * is allowed for its field, using the PRECONDITION_FIELD_CONFIG registry.
 *
 * Extracted to a standalone function so both the router and tests
 * can reference the same logic without duplication.
 */
export function validatePreconditionRules(
  preconditions: z.infer<typeof checkPreconditionsSchema>,
  ctx: z.RefinementCtx,
): void {
  for (let i = 0; i < preconditions.length; i++) {
    const precondition = preconditions[i]!;
    const { field, rule } = precondition;
    const config =
      PRECONDITION_FIELD_CONFIG[
        field as keyof typeof PRECONDITION_FIELD_CONFIG
      ];
    if (!config) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown precondition field "${field}"`,
        path: [i, "field"],
      });
      continue;
    }
    if (!config.allowedRules.includes(rule)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Rule "${rule}" is not allowed for field "${field}"`,
        path: [i, "rule"],
      });
    }
  }
}

/**
 * Preconditions schema with cross-field validation applied.
 */
export const validatedPreconditionsSchema =
  checkPreconditionsSchema.superRefine(validatePreconditionRules);
