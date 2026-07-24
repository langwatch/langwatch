import { z } from "zod";
import { PRECONDITION_ALLOWED_RULES } from "../filters/precondition-matchers";
import type { PreconditionField } from "../filters/precondition-matchers";
import { checkPreconditionsSchema } from "./types";

/**
 * Refinement callback that cross-validates each precondition's rule
 * is allowed for its field, using the PRECONDITION_ALLOWED_RULES registry.
 *
 * Also validates that nested key fields have a `key` provided.
 */
export function validatePreconditionRules(
  preconditions: z.infer<typeof checkPreconditionsSchema>,
  ctx: z.RefinementCtx,
): void {
  for (let i = 0; i < preconditions.length; i++) {
    const precondition = preconditions[i]!;
    const { field, rule } = precondition;
    const allowedRules =
      PRECONDITION_ALLOWED_RULES[field as PreconditionField];
    if (!allowedRules || allowedRules.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Field "${field}" cannot be used as a precondition`,
        path: [i, "field"],
      });
      continue;
    }
    if (!allowedRules.includes(rule)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Rule "${rule}" is not allowed for field "${field}"`,
        path: [i, "rule"],
      });
    }

    // Validate key requirement for nested fields
    if (field === "metadata.value" && !precondition.key) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Field "${field}" requires a key`,
        path: [i, "key"],
      });
    }
  }
}

/**
 * Preconditions schema with cross-field validation applied.
 */
export const validatedPreconditionsSchema =
  checkPreconditionsSchema.superRefine(validatePreconditionRules);
