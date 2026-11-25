import {
  CONTENT_CATEGORIES,
  type DataPrivacyConfig,
  type DataPrivacyRule,
} from "@langwatch/data-privacy-contract";

import {
  attributePatternError,
  customSecretPatternError,
  secretPatternError,
} from "./data-privacy-patterns.ts";
import { configsEqual, isEmptyRuleConfig, type RuleFormState } from "./data-privacy-rule-config.ts";

/** Whether any category or attribute rule restricts content, which is when the audience matters. */
export function formRestrictsContent(form: RuleFormState): boolean {
  return (
    CONTENT_CATEGORIES.some((category) => form.dispositions[category] === "restrict") ||
    form.customAttributes.some((row) => row.disposition === "restrict")
  );
}

export function formHasInvalidPatterns(form: RuleFormState): boolean {
  return (
    form.secretsPatterns.some((pattern) => customSecretPatternError(pattern) !== null) ||
    form.piiExceptPatterns.some((pattern) => secretPatternError(pattern) !== null) ||
    form.customAttributes.some((row) => attributePatternError(row.pattern) !== null)
  );
}

/** Add: the config persists at least one control. Edit: it differs from the rule being edited. */
export function ruleHasChange({
  config,
  editingRule,
}: {
  config: DataPrivacyConfig;
  editingRule: DataPrivacyRule | null;
}): boolean {
  return editingRule ? !configsEqual(config, editingRule.config) : !isEmptyRuleConfig(config);
}
