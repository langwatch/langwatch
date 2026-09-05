import { WEBHOOK_FEATURE_LABEL } from "../subscription/billing-plans";
import type { ComparisonPlanId } from "./planCurrentResolver";

/**
 * A run of bullets under one heading. `label` is null where the tier says
 * little enough that headings would be noise rather than structure.
 */
export type PlanFeatureGroup = { label: string | null; features: string[] };

export type PlanFeatures = {
  /**
   * The "Everything in Free" line, lifted out of the list it was the first
   * item of. It is not a feature — it is the sentence that says the rest of
   * the column is additive — and a tick beside it made it read as one more
   * thing you get rather than as the frame for everything under it.
   */
  inherits: string | null;
  groups: PlanFeatureGroup[];
};

const INHERITS_PREFIX = "Everything in ";

/**
 * The Enterprise column says twelve things, and said flat it reads as a wall
 * of ticks in which single sign-on, audit logs and compliance reviews are
 * three items among twelve. Those are the reason the tier exists, so they
 * lead, under a heading that says what they are.
 *
 * Keyed by the label rather than by position: a bullet that gets reworded
 * moves group with its wording, and a bullet nobody has classified falls into
 * the closing group rather than disappearing. `enterprise-feature-groups`
 * covers the shipped list, so a NEW bullet is caught in a test rather than
 * quietly landing in the catch-all.
 */
const ENTERPRISE_GROUP_BY_FEATURE: Record<string, string> = {
  "Custom SSO / RBAC": "Governance and security",
  "Audit logs": "Governance and security",
  "Compliance and legal reviews": "Governance and security",
  "ISO27001 / SOC2 reports": "Governance and security",
  "Custom terms and DPA": "Governance and security",
  "Alternative hosting options": "Deployment and data",
  "Custom data retention": "Deployment and data",
  [WEBHOOK_FEATURE_LABEL]: "Deployment and data",
  "Uptime & Support SLA": "Support and procurement",
  "Dedicated Solution Engineer": "Support and procurement",
  "Slack / Teams support": "Support and procurement",
  "AWS/Azure/GCP Marketplace": "Support and procurement",
};

/** The order the groups are read in: what the tier is bought FOR comes first. */
const ENTERPRISE_GROUP_ORDER = [
  "Governance and security",
  "Deployment and data",
  "Support and procurement",
] as const;

/** Where a bullet nobody has classified lands. */
export const UNGROUPED_LABEL = "Also included";

/**
 * Reads a plan's flat bullet list as the shape the column actually renders:
 * the inheritance line first, then the bullets, grouped where there are
 * enough of them for grouping to help.
 */
export function readPlanFeatures({
  planId,
  features,
}: {
  planId: ComparisonPlanId;
  features: readonly string[];
}): PlanFeatures {
  const [first, ...rest] = features;
  const inherits = first?.startsWith(INHERITS_PREFIX) ? first : null;
  const bullets = inherits ? rest : [...features];

  return {
    inherits,
    groups:
      planId === "enterprise"
        ? groupEnterpriseFeatures(bullets)
        : [{ label: null, features: bullets }],
  };
}

function groupEnterpriseFeatures(bullets: string[]): PlanFeatureGroup[] {
  const grouped = new Map<string, string[]>();
  for (const feature of bullets) {
    const label = ENTERPRISE_GROUP_BY_FEATURE[feature] ?? UNGROUPED_LABEL;
    grouped.set(label, [...(grouped.get(label) ?? []), feature]);
  }

  return [...ENTERPRISE_GROUP_ORDER, UNGROUPED_LABEL]
    .map((label) => ({ label, features: grouped.get(label) ?? [] }))
    .filter((group) => group.features.length > 0);
}
