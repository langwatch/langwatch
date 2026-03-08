import type {
  CheckPreconditionFields,
  CheckPreconditionRule,
} from "../../server/evaluations/types";
import {
  PRECONDITION_ALLOWED_RULES,
  getAvailablePreconditionFields,
  type PreconditionField,
} from "../../server/filters/precondition-matchers";

/** Human-readable labels for precondition rules */
export const RULE_LABELS: Record<CheckPreconditionRule, string> = {
  contains: "contains",
  not_contains: "does not contain",
  matches_regex: "matches regex",
  is: "is",
};

/**
 * Derive a category from a precondition field name.
 * Uses the field prefix (before first dot) to group into categories.
 * Fields without a prefix are grouped as "Trace".
 */
function deriveCategory(field: string): string {
  if (field === "input" || field === "output") return "Trace";
  const prefix = field.split(".")[0];
  switch (prefix) {
    case "traces":
      return "Trace";
    case "metadata":
      return "Metadata";
    case "spans":
      return "Spans";
    case "topics":
      return "Topics";
    case "evaluations":
      return "Evaluations";
    case "events":
      return "Events";
    case "annotations":
      return "Annotations";
    case "sentiment":
      return "Sentiment";
    default:
      return "Other";
  }
}

/** Group field entries by category for rendering in optgroups */
export function getFieldOptionsByCategory(): {
  category: string;
  fields: { value: CheckPreconditionFields; label: string }[];
}[] {
  const available = getAvailablePreconditionFields();
  const groups = new Map<
    string,
    { value: CheckPreconditionFields; label: string }[]
  >();

  for (const entry of available) {
    const category = deriveCategory(entry.field);
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category)!.push({
      value: entry.field as CheckPreconditionFields,
      label: entry.label,
    });
  }

  return Array.from(groups.entries()).map(([category, fields]) => ({
    category,
    fields,
  }));
}

/** Get the allowed rules for a given field */
export function getAllowedRulesForField(
  field: CheckPreconditionFields,
): CheckPreconditionRule[] {
  return PRECONDITION_ALLOWED_RULES[field as PreconditionField] ?? [];
}

/**
 * Check if a field is a boolean field (true/false selector UI).
 */
export function isBooleanField(field: CheckPreconditionFields): boolean {
  return field === "traces.error" || field === "annotations.hasAnnotation";
}

/**
 * Get the value type for a given field.
 * Kept for backward compatibility with PreconditionsField component.
 */
export function getFieldValueType(
  field: CheckPreconditionFields,
): "text" | "boolean" | "enum" | "array" {
  if (isBooleanField(field)) return "boolean";
  return "text";
}

/** Check if a rule is valid for the given field */
export function isRuleAllowedForField(
  field: CheckPreconditionFields,
  rule: CheckPreconditionRule,
): boolean {
  const allowedRules = PRECONDITION_ALLOWED_RULES[field as PreconditionField];
  if (!allowedRules) return false;
  return allowedRules.includes(rule);
}

/**
 * Determine if preconditions represent only the default origin=application condition.
 * Used to decide whether to show collapsed or expanded precondition UI.
 */
export function isDefaultOnlyPrecondition(
  preconditions: { field: string; rule: string; value: string }[],
): boolean {
  return (
    preconditions.length === 1 &&
    preconditions[0]?.field === "traces.origin" &&
    preconditions[0]?.rule === "is" &&
    preconditions[0]?.value === "application"
  );
}

/** Default precondition for new evaluations */
export const DEFAULT_PRECONDITION = {
  field: "traces.origin" as const,
  rule: "is" as const,
  value: "application",
};
