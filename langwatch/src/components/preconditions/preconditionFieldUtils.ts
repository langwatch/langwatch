import {
  PRECONDITION_FIELD_CONFIG,
  type CheckPreconditionFields,
  type CheckPreconditionRule,
  type PreconditionFieldConfig,
} from "../../server/evaluations/types";

/** Human-readable labels for precondition rules */
export const RULE_LABELS: Record<CheckPreconditionRule, string> = {
  contains: "contains",
  not_contains: "does not contain",
  matches_regex: "matches regex",
  is: "is",
};

/** Group field entries by category for rendering in optgroups */
export function getFieldOptionsByCategory(): {
  category: string;
  fields: { value: CheckPreconditionFields; label: string }[];
}[] {
  const groups = new Map<
    string,
    { value: CheckPreconditionFields; label: string }[]
  >();

  for (const [field, config] of Object.entries(PRECONDITION_FIELD_CONFIG)) {
    const fieldConfig = config as PreconditionFieldConfig;
    if (!groups.has(fieldConfig.category)) {
      groups.set(fieldConfig.category, []);
    }
    groups.get(fieldConfig.category)!.push({
      value: field as CheckPreconditionFields,
      label: fieldConfig.label,
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
  return PRECONDITION_FIELD_CONFIG[field]?.allowedRules ?? [];
}

/** Get the value type for a given field */
export function getFieldValueType(
  field: CheckPreconditionFields,
): PreconditionFieldConfig["valueType"] {
  return PRECONDITION_FIELD_CONFIG[field]?.valueType ?? "text";
}

/** Check if a rule is valid for the given field */
export function isRuleAllowedForField(
  field: CheckPreconditionFields,
  rule: CheckPreconditionRule,
): boolean {
  const config = PRECONDITION_FIELD_CONFIG[field];
  if (!config) return false;
  return config.allowedRules.includes(rule);
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
