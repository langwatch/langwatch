import { filterFieldsEnum } from "@langwatch/analytics-contract";
import { z } from "zod";

export const checkPreconditionRuleSchema = z.enum([
  "contains",
  "not_contains",
  "matches_regex",
  "is",
]);

export type CheckPreconditionRule = z.infer<typeof checkPreconditionRuleSchema>;

/** All fields usable in preconditions: every FilterField plus input/output */
export const checkPreconditionFieldsSchema = z.union([
  filterFieldsEnum,
  z.literal("input"),
  z.literal("output"),
]);

export type CheckPreconditionFields = z.infer<typeof checkPreconditionFieldsSchema>;

export const checkPreconditionSchema = z.object({
  field: checkPreconditionFieldsSchema,
  rule: checkPreconditionRuleSchema,
  value: z.string().min(1).max(500),
  /** Key for nested filters (e.g., metadata key name for metadata.value) */
  key: z.string().optional(),
  /** Subkey for double-nested filters (e.g., event detail key) */
  subkey: z.string().optional(),
});

export type CheckPrecondition = z.infer<typeof checkPreconditionSchema>;

export const checkPreconditionsSchema = z.array(checkPreconditionSchema);

export type CheckPreconditions = z.infer<typeof checkPreconditionsSchema>;
