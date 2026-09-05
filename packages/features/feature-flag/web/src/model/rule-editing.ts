import type { FeatureFlagRule, FeatureFlagRules } from "@langwatch/feature-flag-contract";

/**
 * The editing model behind the targeting-rules dialog: one row per rule,
 * every condition field shown at once. Translates the stored `match` shape
 * to and from that flat editor row, kept free of React.
 */
export interface FeatureFlagRuleEditorRule {
  organizationId: string;
  projectId: string;
  percentage: string;
  /**
   * "New organizations": an ISO date; every organization created on or after
   * it matches. Names a date instead of an id, since new signups have none.
   */
  organizationCreatedAfter: string;
  enabled: boolean;
  preservedMatch: FeatureFlagRule["match"];
}

export function rulesToEditor(rules: FeatureFlagRules): FeatureFlagRuleEditorRule[] {
  if (rules.length === 0) {
    return [newEditorRule()];
  }

  return rules.map((rule) => ({
    organizationId: rule.match.organizationId ?? "",
    projectId: rule.match.projectId ?? "",
    percentage: rule.match.percentage?.toString() ?? "",
    organizationCreatedAfter: rule.match.organizationCreatedAfter ?? "",
    enabled: rule.enabled,
    preservedMatch: { ...rule.match },
  }));
}

export function editorToRules(rules: FeatureFlagRuleEditorRule[]): FeatureFlagRules {
  return rules.map((rule) => {
    const match = { ...rule.preservedMatch };
    delete match.organizationId;
    delete match.projectId;
    delete match.percentage;
    delete match.organizationCreatedAfter;

    const organizationId = rule.organizationId.trim();
    const projectId = rule.projectId.trim();
    const percentage = rule.percentage.trim();
    const organizationCreatedAfter = rule.organizationCreatedAfter.trim();
    if (organizationId) match.organizationId = organizationId;
    if (projectId) match.projectId = projectId;
    if (percentage) match.percentage = Number(percentage);
    if (organizationCreatedAfter) match.organizationCreatedAfter = organizationCreatedAfter;

    return { match, enabled: rule.enabled };
  });
}

export function newEditorRule(): FeatureFlagRuleEditorRule {
  return {
    organizationId: "",
    projectId: "",
    percentage: "",
    organizationCreatedAfter: "",
    enabled: true,
    preservedMatch: {},
  };
}

export function validCreatedAfter(value: string): boolean {
  if (!value.trim()) return true;
  return !Number.isNaN(Date.parse(value));
}

export function validPercentage(value: string): boolean {
  if (!value.trim()) return true;
  const percentage = Number(value);

  return Number.isInteger(percentage) && percentage >= 0 && percentage <= 100;
}
